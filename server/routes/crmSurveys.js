const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const Survey = require('../models/crm/Survey');
const SurveyResponse = require('../models/crm/SurveyResponse');
const User = require('../models/User');
const Notification = require('../models/hr/Notification');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/crm/surveys');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'survey-report-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

const CRM_ROLES = ['super_admin', 'admin', 'crm_manager', 'sales_manager'];

const normalizeRoleName = (role) => String(role || '').toLowerCase().replace(/\s+/g, '_');

const getRefId = (ref) => {
  if (!ref) return null;
  if (typeof ref === 'object' && ref._id) return String(ref._id);
  return String(ref);
};

const roleHasCrmSurveyAccess = (permissions = []) => {
  if (!Array.isArray(permissions)) return false;
  const crmPerm = permissions.find((p) => p.module === 'crm');
  if (!crmPerm) return false;

  const hasModuleRead = Array.isArray(crmPerm.actions) && crmPerm.actions.includes('read');
  const hasSurveySubmodule = Array.isArray(crmPerm.submodules) && crmPerm.submodules.some((sm) => {
    if (typeof sm === 'string') return sm === 'crm_surveys';
    return sm?.name === 'crm_surveys'
      && Array.isArray(sm.actions)
      && (sm.actions.includes('read') || sm.actions.includes('create') || sm.actions.includes('update'));
  });

  return hasModuleRead || hasSurveySubmodule;
};

const userHasCrmSurveyAccess = (user) => {
  if (!user) return false;

  const legacyRole = normalizeRoleName(user.role);
  if (['super_admin', 'higher_management', 'developer', 'admin'].includes(legacyRole)) return true;
  if (CRM_ROLES.map(normalizeRoleName).includes(legacyRole)) return true;

  if (user.roleRef?.permissions && roleHasCrmSurveyAccess(user.roleRef.permissions)) return true;
  if (Array.isArray(user.roles)) {
    return user.roles.some((role) => role?.permissions && roleHasCrmSurveyAccess(role.permissions));
  }

  return false;
};

const canManageSurvey = (survey, user) => {
  if (!survey || !user) return false;
  if (userHasCrmSurveyAccess(user)) return true;
  return getRefId(survey.createdBy) === String(user._id);
};

const isUserAssigned = (survey, userId) =>
  (survey.targetUsers || []).some((entry) => getRefId(entry) === String(userId));

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  return next();
};

/** Date-only values (YYYY-MM-DD) mean "open through end of that day", not midnight UTC. */
const parseCloseDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(`${str}T23:59:59.999Z`);
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Legacy surveys stored close date as UTC midnight — treat as end of that calendar day. */
const effectiveCloseDate = (closesAt) => {
  if (!closesAt) return null;
  const close = new Date(closesAt);
  if (Number.isNaN(close.getTime())) return null;

  const isUtcMidnight = close.getUTCHours() === 0
    && close.getUTCMinutes() === 0
    && close.getUTCSeconds() === 0
    && close.getUTCMilliseconds() === 0;

  if (isUtcMidnight) {
    const y = close.getUTCFullYear();
    const m = String(close.getUTCMonth() + 1).padStart(2, '0');
    const d = String(close.getUTCDate()).padStart(2, '0');
    return new Date(`${y}-${m}-${d}T23:59:59.999Z`);
  }

  return close;
};

const isSurveyPastCloseDate = (closesAt) => {
  const close = effectiveCloseDate(closesAt);
  if (!close) return false;
  return Date.now() > close.getTime();
};

const normalizeQuestions = (questions = []) => questions.map((q, index) => ({
  key: q.key || Survey.generateQuestionKey(),
  type: q.type,
  label: String(q.label || '').trim(),
  description: String(q.description || '').trim(),
  required: Boolean(q.required),
  options: (q.options || []).map((opt) => ({
    label: String(opt.label || '').trim(),
    value: String(opt.value ?? opt.label ?? '').trim()
  })).filter((opt) => opt.label),
  min: Number.isFinite(Number(q.min)) ? Number(q.min) : 1,
  max: Number.isFinite(Number(q.max)) ? Number(q.max) : 5,
  order: Number.isFinite(Number(q.order)) ? Number(q.order) : index
}));

const normalizeSections = (sections = [], legacyQuestions = []) => {
  if (Array.isArray(sections) && sections.length) {
    return sections.map((section, sectionIndex) => ({
      key: section.key || Survey.generateSectionKey(),
      title: String(section.title || '').trim() || `Section ${sectionIndex + 1}`,
      isInternal: Boolean(section.isInternal),
      order: Number.isFinite(Number(section.order)) ? Number(section.order) : sectionIndex,
      questions: normalizeQuestions(section.questions || [])
    }));
  }

  const normalizedQuestions = normalizeQuestions(legacyQuestions);
  if (!normalizedQuestions.length) return [];

  return [{
    key: Survey.generateSectionKey(),
    title: 'General',
    order: 0,
    questions: normalizedQuestions
  }];
};

const applySurveyStructure = (survey, { sections, questions } = {}) => {
  const normalizedSections = normalizeSections(sections, questions);
  survey.sections = normalizedSections;
  survey.questions = normalizedSections.flatMap((section) => section.questions || []);
  return survey;
};

const getSurveyQuestions = (survey) => {
  if (survey?.sections?.length) {
    return survey.sections.flatMap((section) => section.questions || []);
  }
  return survey?.questions || [];
};

const validatePollShape = (kind, questions = []) => {
  if (kind !== 'poll') return [];
  const errors = [];
  if (questions.length !== 1) {
    errors.push('A poll must have exactly one question');
    return errors;
  }
  const question = questions[0];
  if (!['single_choice', 'yes_no'].includes(question.type)) {
    errors.push('Poll questions must be single choice or yes/no');
  }
  if (question.type === 'single_choice' && (question.options?.length || 0) < 2) {
    errors.push('Poll needs at least 2 options');
  }
  if (!String(question.label || '').trim()) {
    errors.push('Poll question is required');
  }
  return errors;
};

const buildPollResults = (survey, responses = []) => {
  const question = survey.questions?.[0];
  if (!question) return { totalVotes: 0, distribution: [] };

  const counts = {};
  if (question.type === 'yes_no') {
    counts.yes = 0;
    counts.no = 0;
  } else {
    (question.options || []).forEach((opt) => { counts[opt.value] = 0; });
  }

  responses.forEach((response) => {
    const raw = response.answers?.find((a) => a.questionKey === question.key)?.value;
    if (raw === undefined || raw === null || raw === '') return;
    const key = String(raw);
    counts[key] = (counts[key] || 0) + 1;
  });

  const totalVotes = responses.length;
  const distribution = Object.entries(counts).map(([value, count]) => ({
    value,
    label: question.type === 'yes_no'
      ? (value === 'yes' ? 'Yes' : value === 'no' ? 'No' : value)
      : (question.options || []).find((o) => o.value === value)?.label || value,
    count,
    percent: totalVotes ? Math.round((count / totalVotes) * 100) : 0
  }));

  return { totalVotes, distribution, question: { key: question.key, label: question.label, type: question.type } };
};

const validateAnswers = (survey, answers = []) => {
  const errors = [];
  const answerMap = new Map(answers.map((a) => [a.questionKey, a.value]));

  survey.questions.forEach((question) => {
    const value = answerMap.get(question.key);
    const empty = value === undefined || value === null || value === ''
      || (Array.isArray(value) && value.length === 0);

    if (question.required && empty) {
      errors.push(`"${question.label}" is required`);
      return;
    }

    if (empty) return;

    if (question.type === 'number' && Number.isNaN(Number(value))) {
      errors.push(`"${question.label}" must be a number`);
    }

    if (question.type === 'rating') {
      const num = Number(value);
      if (Number.isNaN(num) || num < question.min || num > question.max) {
        errors.push(`"${question.label}" must be between ${question.min} and ${question.max}`);
      }
    }

    if (question.type === 'single_choice') {
      const allowed = (question.options || []).map((o) => o.value);
      if (!allowed.includes(String(value))) {
        errors.push(`"${question.label}" has an invalid choice`);
      }
    }

    if (question.type === 'multiple_choice') {
      const allowed = new Set((question.options || []).map((o) => o.value));
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      if (!values.every((v) => allowed.has(v))) {
        errors.push(`"${question.label}" has invalid choices`);
      }
    }
  });

  return errors;
};

const buildQuestionAnalytics = (survey, responses) => {
  return survey.questions.map((question) => {
    const answers = responses
      .map((r) => r.answers.find((a) => a.questionKey === question.key)?.value)
      .filter((v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));

    const base = {
      key: question.key,
      label: question.label,
      type: question.type,
      totalAnswers: answers.length,
      responseRate: responses.length
        ? Math.round((answers.length / responses.length) * 100)
        : 0
    };

    if (['single_choice', 'multiple_choice', 'yes_no'].includes(question.type)) {
      const counts = {};
      (question.options || []).forEach((opt) => { counts[opt.value] = 0; });
      if (question.type === 'yes_no') {
        counts.yes = 0;
        counts.no = 0;
      }

      answers.forEach((value) => {
        if (Array.isArray(value)) {
          value.forEach((v) => { counts[String(v)] = (counts[String(v)] || 0) + 1; });
        } else {
          const key = String(value);
          counts[key] = (counts[key] || 0) + 1;
        }
      });

      return {
        ...base,
        distribution: Object.entries(counts).map(([value, count]) => ({
          value,
          label: (question.options || []).find((o) => o.value === value)?.label || value,
          count,
          percent: answers.length ? Math.round((count / answers.length) * 100) : 0
        }))
      };
    }

    if (question.type === 'rating' || question.type === 'number') {
      const nums = answers.map(Number).filter((n) => !Number.isNaN(n));
      const avg = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
      const min = question.min || 1;
      const max = question.max || 5;
      const buckets = {};
      for (let i = min; i <= max; i += 1) buckets[i] = 0;
      nums.forEach((n) => {
        if (n >= min && n <= max) buckets[n] = (buckets[n] || 0) + 1;
      });

      return {
        ...base,
        average: Math.round(avg * 100) / 100,
        min: nums.length ? Math.min(...nums) : null,
        max: nums.length ? Math.max(...nums) : null,
        distribution: Object.entries(buckets).map(([value, count]) => ({
          value: Number(value),
          label: String(value),
          count,
          percent: nums.length ? Math.round((count / nums.length) * 100) : 0
        }))
      };
    }

    return {
      ...base,
      textAnswers: answers.slice(0, 50).map((value) => (
        Array.isArray(value) ? value.join(', ') : String(value)
      ))
    };
  });
};

const buildLikertChartData = (survey, responses) => {
  const ratingQuestions = (survey.questions || []).filter((q) => q.type === 'rating');
  return ratingQuestions.map((question, index) => {
    const min = question.min || 1;
    const max = question.max || 5;
    const row = {
      question: `Q${index + 1}`,
      key: question.key,
      label: question.label
    };
    for (let score = min; score <= max; score += 1) {
      row[`score_${score}`] = 0;
    }
    responses.forEach((response) => {
      const raw = response.answers.find((a) => a.questionKey === question.key)?.value;
      const num = Number(raw);
      if (!Number.isNaN(num) && num >= min && num <= max) {
        row[`score_${num}`] += 1;
      }
    });
    return row;
  });
};

const buildChoiceChartData = (survey, responses) => {
  const choiceQuestions = (survey.questions || []).filter((q) =>
    ['single_choice', 'multiple_choice', 'yes_no'].includes(q.type)
  );
  return choiceQuestions.slice(0, 10).map((question, index) => {
    const row = { question: `Q${index + 1}`, key: question.key, label: question.label };
    const options = question.type === 'yes_no'
      ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
      : (question.options || []);

    options.forEach((opt, optIndex) => {
      row[`opt_${optIndex}`] = 0;
      row[`opt_${optIndex}_label`] = opt.label;
    });

    responses.forEach((response) => {
      const raw = response.answers.find((a) => a.questionKey === question.key)?.value;
      if (raw === undefined || raw === null || raw === '') return;
      const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      options.forEach((opt, optIndex) => {
        if (values.includes(String(opt.value))) row[`opt_${optIndex}`] += 1;
      });
    });

    return row;
  });
};

const calcAvgSatisfaction = (survey, responses) => {
  const ratingQuestions = (survey.questions || []).filter((q) => q.type === 'rating');
  if (!ratingQuestions.length) return null;

  let sum = 0;
  let count = 0;
  let maxScale = 5;

  responses.forEach((response) => {
    ratingQuestions.forEach((question) => {
      const raw = response.answers.find((a) => a.questionKey === question.key)?.value;
      const num = Number(raw);
      if (!Number.isNaN(num)) {
        sum += num;
        count += 1;
        maxScale = question.max || 5;
      }
    });
  });

  if (!count) return null;
  return {
    average: Math.round((sum / count) * 10) / 10,
    max: maxScale
  };
};

const buildDepartmentScores = (responses) => {
  const deptMap = {};

  responses.forEach((response) => {
    const dept = response.respondent?.department || 'Unassigned';
    if (!deptMap[dept]) deptMap[dept] = { sum: 0, count: 0 };

    response.answers.forEach((answer) => {
      const num = Number(answer.value);
      if (!Number.isNaN(num)) {
        deptMap[dept].sum += num;
        deptMap[dept].count += 1;
      }
    });
  });

  return Object.entries(deptMap)
    .filter(([, stats]) => stats.count > 0)
    .map(([department, stats]) => ({
      department,
      average: Math.round((stats.sum / stats.count) * 10) / 10,
      responses: stats.count
    }))
    .sort((a, b) => b.average - a.average)
    .slice(0, 8);
};

const buildDailyVolume = (responses) => {
  const byDate = {};
  responses.forEach((response) => {
    const day = new Date(response.submittedAt).toISOString().slice(0, 10);
    byDate[day] = (byDate[day] || 0) + 1;
  });

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({
      date,
      label: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count
    }));
};

const buildStatusBreakdown = (assignedCount, responseCount) => {
  const completed = responseCount;
  const notStarted = Math.max(0, assignedCount - responseCount);
  return [
    { name: 'Completed', value: completed, color: '#3B82F6' },
    { name: 'Not Started', value: notStarted, color: '#94A3B8' }
  ].filter((item) => item.value > 0);
};

const COMMCRAFT_RISK_LEVELS = ['Low', 'Medium', 'High'];
const COMMCRAFT_ACTIONS = ['Immediate', 'This Month', 'Monitor Only'];

const normalizeCommcraftReviewPayload = (body = {}) => ({
  crossCompanyObservations: String(body.crossCompanyObservations || '').trim(),
  requiredFollowUp: String(body.requiredFollowUp || '').trim(),
  riskLevel: COMMCRAFT_RISK_LEVELS.includes(body.riskLevel) ? body.riskLevel : null,
  actionRequired: COMMCRAFT_ACTIONS.includes(body.actionRequired) ? body.actionRequired : null
});

const serializeCommcraftReview = (review) => {
  if (!review) {
    return {
      crossCompanyObservations: '',
      requiredFollowUp: '',
      riskLevel: null,
      actionRequired: null,
      reviewedBy: null,
      reviewedAt: null
    };
  }

  return {
    crossCompanyObservations: review.crossCompanyObservations || '',
    requiredFollowUp: review.requiredFollowUp || '',
    riskLevel: review.riskLevel || null,
    actionRequired: review.actionRequired || null,
    reviewedBy: review.reviewedBy || null,
    reviewedAt: review.reviewedAt || null
  };
};

// GET /api/crm/surveys
router.get('/',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const { status, search, page = 1, limit = 20, kind } = req.query;
    const filter = {};

    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      filter.createdBy = req.user._id;
    }

    if (status) filter.status = status;
    if (kind && ['survey', 'poll'].includes(kind)) filter.kind = kind;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

    const [surveys, total] = await Promise.all([
      Survey.find(filter)
        .populate('createdBy', 'firstName lastName email')
        .populate('targetUsers', 'firstName lastName email')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Survey.countDocuments(filter)
    ]);

    const surveyIds = surveys.map((s) => s._id);
    const responseCounts = await SurveyResponse.aggregate([
      { $match: { survey: { $in: surveyIds } } },
      { $group: { _id: '$survey', count: { $sum: 1 } } }
    ]);
    const countMap = Object.fromEntries(responseCounts.map((r) => [String(r._id), r.count]));

    const data = surveys.map((survey) => ({
      ...survey,
      responseCount: countMap[String(survey._id)] || 0,
      assignedCount: survey.targetUsers?.length || 0,
      hasCommcraftReview: Boolean(survey.commcraftReview?.reviewedAt)
    }));

    res.json({
      success: true,
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)) || 1
      }
    });
  })
);

// GET /api/crm/surveys/assignable-users
router.get('/assignable-users',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const users = await User.find({ isActive: true })
      .select('firstName lastName email role department')
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    res.json({ success: true, data: users });
  })
);

// GET /api/crm/surveys/my
router.get('/my',
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const surveys = await Survey.find({
      status: 'active',
      targetUsers: userId
    })
      .populate('createdBy', 'firstName lastName email')
      .sort({ publishedAt: -1, updatedAt: -1 })
      .lean();

    const surveyIds = surveys.map((s) => s._id);
    const myResponses = await SurveyResponse.find({
      survey: { $in: surveyIds },
      respondent: userId
    }).lean();

    const respondedSet = new Set(myResponses.map((r) => String(r.survey)));

    const data = surveys.map((survey) => ({
      ...survey,
      hasResponded: respondedSet.has(String(survey._id)),
      questionCount: survey.questions?.length || 0
    }));

    res.json({ success: true, data });
  })
);

// GET /api/crm/surveys/executive-dashboard
router.get('/executive-dashboard',
  asyncHandler(async (req, res) => {
    if (!userHasCrmSurveyAccess(req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view executive dashboard' });
    }
    const [activeAndClosed, draftCount] = await Promise.all([
      Survey.find({ status: { $in: ['active', 'closed'] } })
        .populate('createdBy', 'firstName lastName email')
        .sort({ updatedAt: -1 })
        .lean(),
      Survey.countDocuments({ status: 'draft' })
    ]);

    const surveyIds = activeAndClosed.map((s) => s._id);
    const allResponses = surveyIds.length
      ? await SurveyResponse.find({ survey: { $in: surveyIds } })
        .populate('respondent', 'firstName lastName email department')
        .sort({ submittedAt: -1 })
        .lean()
      : [];

    const responsesBySurvey = {};
    allResponses.forEach((response) => {
      const sid = String(response.survey);
      if (!responsesBySurvey[sid]) responsesBySurvey[sid] = [];
      responsesBySurvey[sid].push(response);
    });

    let totalAssigned = 0;
    let ratingSum = 0;
    let ratingCount = 0;

    const surveySummaries = activeAndClosed.map((survey) => {
      const sid = String(survey._id);
      const responses = responsesBySurvey[sid] || [];
      const assigned = survey.targetUsers?.length || 0;
      const responseCount = responses.length;
      const responseRate = assigned ? Math.round((responseCount / assigned) * 100) : 0;
      totalAssigned += assigned;

      const ratingQuestions = (survey.questions || []).filter((q) => q.type === 'rating');
      let surveyRatingSum = 0;
      let surveyRatingCount = 0;
      let maxScale = 5;

      responses.forEach((response) => {
        ratingQuestions.forEach((question) => {
          const raw = response.answers.find((a) => a.questionKey === question.key)?.value;
          const num = Number(raw);
          if (!Number.isNaN(num)) {
            surveyRatingSum += num;
            surveyRatingCount += 1;
            ratingSum += num;
            ratingCount += 1;
            maxScale = question.max || 5;
          }
        });
      });

      return {
        _id: survey._id,
        title: survey.title,
        status: survey.status,
        questionCount: survey.questions?.length || 0,
        assignedCount: assigned,
        responseCount,
        responseRate,
        pendingCount: Math.max(0, assigned - responseCount),
        avgSatisfaction: surveyRatingCount
          ? { average: Math.round((surveyRatingSum / surveyRatingCount) * 10) / 10, max: maxScale }
          : null,
        publishedAt: survey.publishedAt,
        createdBy: survey.createdBy,
        analysisReport: (survey.analysisReport && survey.analysisReport.isSentToManagement &&
          (req.user.role === 'super_admin' || 
           (survey.analysisReport.targetUsers && survey.analysisReport.targetUsers.some(uid => String(uid) === String(req.user._id))) ||
           String(survey.createdBy?._id || survey.createdBy) === String(req.user._id)
          )) ? survey.analysisReport : undefined
      };
    });

    const totalResponses = allResponses.length;
    const totalPending = surveySummaries.reduce((sum, item) => sum + item.pendingCount, 0);
    const overallCompletionRate = totalAssigned
      ? Math.round((totalResponses / totalAssigned) * 100)
      : 0;

    const deptMap = {};
    allResponses.forEach((response) => {
      const dept = response.respondent?.department || 'Unassigned';
      deptMap[dept] = (deptMap[dept] || 0) + 1;
    });

    const departmentParticipation = Object.entries(deptMap)
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const surveyResponseChart = [...surveySummaries]
      .filter((item) => item.responseCount > 0)
      .sort((a, b) => b.responseCount - a.responseCount)
      .slice(0, 10)
      .map((item) => ({
        name: item.title.length > 36 ? `${item.title.slice(0, 36)}…` : item.title,
        fullTitle: item.title,
        responses: item.responseCount,
        assigned: item.assignedCount,
        completionRate: item.responseRate,
        id: item._id
      }));

    const recentResponses = allResponses.slice(0, 15).map((response) => {
      const survey = activeAndClosed.find((s) => String(s._id) === String(response.survey));
      return {
        _id: response._id,
        surveyId: response.survey,
        surveyTitle: survey?.title || 'Survey',
        respondent: response.respondent,
        submittedAt: response.submittedAt,
        answerCount: response.answers?.length || 0
      };
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalSurveys: activeAndClosed.length,
          activeSurveys: activeAndClosed.filter((s) => s.status === 'active').length,
          closedSurveys: activeAndClosed.filter((s) => s.status === 'closed').length,
          draftSurveys: draftCount,
          totalAssigned,
          totalResponses,
          overallCompletionRate,
          totalPending,
          avgSatisfaction: ratingCount
            ? { average: Math.round((ratingSum / ratingCount) * 10) / 10, max: 5 }
            : null
        },
        charts: {
          surveyResponseChart,
          departmentParticipation,
          dailyVolume: buildDailyVolume(allResponses),
          statusBreakdown: buildStatusBreakdown(totalAssigned, totalResponses)
        },
        surveys: surveySummaries,
        recentResponses
      }
    });
  })
);

// GET /api/crm/surveys/:id/poll-results
router.get('/:id/poll-results',
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id).lean();
    if (!survey || survey.kind !== 'poll') {
      return res.status(404).json({ success: false, message: 'Poll not found' });
    }

    const isManager = userHasCrmSurveyAccess(req.user) || canManageSurvey(survey, req.user);
    const assigned = isUserAssigned(survey, req.user._id);

    if (!isManager && !assigned) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const myResponse = await SurveyResponse.findOne({
      survey: survey._id,
      respondent: req.user._id
    }).lean();

    if (!survey.showResultsToVoters && !isManager && !myResponse) {
      return res.status(403).json({ success: false, message: 'Vote first to see poll results' });
    }

    const responses = await SurveyResponse.find({ survey: survey._id }).lean();
    const results = buildPollResults(survey, responses);

    res.json({
      success: true,
      data: {
        ...results,
        showResultsToVoters: survey.showResultsToVoters,
        hasVoted: Boolean(myResponse)
      }
    });
  })
);

// GET /api/crm/surveys/:id
router.get('/:id',
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email')
      .populate('targetUsers', 'firstName lastName email');

    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    const isManager = userHasCrmSurveyAccess(req.user) || canManageSurvey(survey, req.user);
    const assigned = isUserAssigned(survey, req.user._id);

    if (!isManager && !assigned) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this survey' });
    }

    const responseCount = await SurveyResponse.countDocuments({ survey: survey._id });
    const myResponse = await SurveyResponse.findOne({
      survey: survey._id,
      respondent: req.user._id
    }).lean();

    res.json({
      success: true,
      data: {
        ...survey.toObject(),
        responseCount,
        hasResponded: Boolean(myResponse),
        myResponse: myResponse
          ? { answers: myResponse.answers, submittedAt: myResponse.submittedAt }
          : null,
        canManage: isManager
      }
    });
  })
);

// POST /api/crm/surveys
router.post('/',
  authorize(...CRM_ROLES),
  [
    body('title').trim().notEmpty().withMessage('Title is required')
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      questions,
      sections,
      targetUsers = [],
      closesAt,
      allowMultipleResponses = false,
      status = 'draft',
      kind = 'survey',
      showResultsToVoters = true
    } = req.body;

    const surveyKind = kind === 'poll' ? 'poll' : 'survey';
    const normalizedSections = normalizeSections(sections, questions);
    const flatQuestions = normalizedSections.flatMap((section) => section.questions || []);

    if (!flatQuestions.length) {
      return res.status(400).json({ success: false, message: 'At least one question is required' });
    }

    const pollErrors = validatePollShape(surveyKind, flatQuestions);
    if (pollErrors.length) {
      return res.status(400).json({ success: false, message: pollErrors.join('; ') });
    }

    const survey = await Survey.create({
      title: String(title).trim(),
      description: String(description || '').trim(),
      sections: normalizedSections,
      questions: flatQuestions,
      targetUsers,
      closesAt: parseCloseDate(closesAt),
      allowMultipleResponses: Boolean(allowMultipleResponses),
      status: ['draft', 'active', 'closed'].includes(status) ? status : 'draft',
      kind: surveyKind,
      showResultsToVoters: surveyKind === 'poll' ? Boolean(showResultsToVoters) : false,
      createdBy: req.user._id,
      publishedAt: status === 'active' ? new Date() : undefined
    });

    await survey.populate('createdBy', 'firstName lastName email');
    await survey.populate('targetUsers', 'firstName lastName email');

    res.status(201).json({ success: true, data: survey });
  })
);

// PUT /api/crm/surveys/:id
router.put('/:id',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    if (!canManageSurvey(survey, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const {
      title,
      description,
      questions,
      sections,
      targetUsers,
      closesAt,
      allowMultipleResponses,
      status,
      kind,
      showResultsToVoters
    } = req.body;

    if (title !== undefined) survey.title = String(title).trim();
    if (description !== undefined) survey.description = String(description).trim();
    if (sections !== undefined || questions !== undefined) {
      applySurveyStructure(survey, {
        sections: sections !== undefined ? sections : survey.sections,
        questions: questions !== undefined ? questions : survey.questions
      });
    }
    if (targetUsers !== undefined) survey.targetUsers = targetUsers;
    if (closesAt !== undefined) survey.closesAt = parseCloseDate(closesAt);
    if (allowMultipleResponses !== undefined) survey.allowMultipleResponses = Boolean(allowMultipleResponses);
    if (kind !== undefined && ['survey', 'poll'].includes(kind)) survey.kind = kind;
    if (showResultsToVoters !== undefined) survey.showResultsToVoters = Boolean(showResultsToVoters);

    const pollErrors = validatePollShape(survey.kind, survey.questions);
    if (pollErrors.length) {
      return res.status(400).json({ success: false, message: pollErrors.join('; ') });
    }

    if (status !== undefined && ['draft', 'active', 'closed'].includes(status)) {
      survey.status = status;
      if (status === 'active' && !survey.publishedAt) survey.publishedAt = new Date();
    }

    await survey.save();
    await survey.populate('createdBy', 'firstName lastName email');
    await survey.populate('targetUsers', 'firstName lastName email');

    res.json({ success: true, data: survey });
  })
);

// POST /api/crm/surveys/:id/publish
router.post('/:id/publish',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    if (!canManageSurvey(survey, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (!survey.questions?.length) {
      return res.status(400).json({ success: false, message: 'Add at least one question before sending' });
    }

    if (Array.isArray(req.body.targetUsers) && req.body.targetUsers.length) {
      survey.targetUsers = req.body.targetUsers;
    }

    if (!survey.targetUsers?.length) {
      return res.status(400).json({ success: false, message: 'Select at least one user to send the survey' });
    }

    survey.status = 'active';
    survey.publishedAt = survey.publishedAt || new Date();
    await survey.save();
    await survey.populate('targetUsers', 'firstName lastName email');

    res.json({
      success: true,
      message: `Survey sent to ${survey.targetUsers.length} user(s)`,
      data: survey
    });
  })
);

// DELETE /api/crm/surveys/:id
router.delete('/:id',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    if (!canManageSurvey(survey, req.user)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await SurveyResponse.deleteMany({ survey: survey._id });
    await survey.deleteOne();

    res.json({ success: true, message: 'Survey deleted' });
  })
);

// POST /api/crm/surveys/:id/responses
router.post('/:id/responses',
  [
    param('id').isMongoId(),
    body('answers').isArray()
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    if (survey.status !== 'active') {
      return res.status(400).json({ success: false, message: 'This survey is not accepting responses' });
    }

    if (isSurveyPastCloseDate(survey.closesAt)) {
      return res.status(400).json({ success: false, message: 'This survey has closed' });
    }

    if (!isUserAssigned(survey, req.user._id)) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this survey' });
    }

    const existing = await SurveyResponse.findOne({
      survey: survey._id,
      respondent: req.user._id
    });

    if (existing && !survey.allowMultipleResponses) {
      return res.status(409).json({ success: false, message: 'You have already submitted this survey' });
    }

    const validationErrors = validateAnswers(survey, req.body.answers);
    if (validationErrors.length) {
      return res.status(400).json({ success: false, message: validationErrors.join('; ') });
    }

    const response = await SurveyResponse.create({
      survey: survey._id,
      respondent: req.user._id,
      answers: req.body.answers
    });

    await response.populate('respondent', 'firstName lastName email');

    res.status(201).json({ success: true, data: response, message: 'Survey submitted successfully' });
  })
);

// GET /api/crm/surveys/:id/responses
router.get('/:id/responses',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    const responses = await SurveyResponse.find({ survey: survey._id })
      .populate('respondent', 'firstName lastName email')
      .sort({ submittedAt: -1 })
      .lean();

    res.json({ success: true, data: responses });
  })
);

// PATCH /api/crm/surveys/:id/responses/:responseId/internal
router.patch('/:id/responses/:responseId/internal',
  authorize(...CRM_ROLES),
  [
    body('answers').isArray()
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: 'Survey not found' });

    const response = await SurveyResponse.findOne({ _id: req.params.responseId, survey: survey._id });
    if (!response) return res.status(404).json({ success: false, message: 'Response not found' });

    // Merge new answers into existing answers
    const newAnswers = req.body.answers;
    const mergedAnswers = [...response.answers];

    newAnswers.forEach(newAnswer => {
      const idx = mergedAnswers.findIndex(a => a.questionKey === newAnswer.questionKey);
      if (idx !== -1) {
        mergedAnswers[idx].value = newAnswer.value;
      } else {
        mergedAnswers.push(newAnswer);
      }
    });

    response.answers = mergedAnswers;
    await response.save();

    await response.populate('respondent', 'firstName lastName email');
    res.json({ success: true, data: response, message: 'Internal review saved successfully' });
  })
);

// GET /api/crm/surveys/:id/analytics
router.get('/:id/analytics',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id).lean();
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    const responses = await SurveyResponse.find({ survey: survey._id })
      .populate('respondent', 'firstName lastName email department')
      .sort({ submittedAt: -1 })
      .lean();

    const assignedCount = survey.targetUsers?.length || 0;
    const responseCount = responses.length;
    const responseRate = assignedCount
      ? Math.round((responseCount / assignedCount) * 100)
      : 0;

    const respondedUserIds = new Set(responses.map((r) => String(r.respondent?._id || r.respondent)));
    const pendingUsers = await User.find({
      _id: { $in: survey.targetUsers || [], $nin: [...respondedUserIds] },
      isActive: true
    }).select('firstName lastName email department').lean();

    const likertChartData = buildLikertChartData(survey, responses);
    const choiceChartData = buildChoiceChartData(survey, responses);
    const avgSatisfaction = calcAvgSatisfaction(survey, responses);

    res.json({
      success: true,
      data: {
        survey: {
          _id: survey._id,
          title: survey.title,
          description: survey.description,
          status: survey.status,
          publishedAt: survey.publishedAt,
          closesAt: survey.closesAt,
          questionCount: survey.questions?.length || 0,
          questions: survey.questions || [],
          sections: survey.sections || []
        },
        summary: {
          assignedCount,
          responseCount,
          responseRate,
          pendingCount: Math.max(0, assignedCount - responseCount),
          avgSatisfaction
        },
        charts: {
          likertChartData,
          choiceChartData,
          departmentScores: buildDepartmentScores(responses),
          statusBreakdown: buildStatusBreakdown(assignedCount, responseCount),
          dailyVolume: buildDailyVolume(responses)
        },
        questionAnalytics: buildQuestionAnalytics(survey, responses),
        recentResponses: responses.slice(0, 20),
        pendingUsers
      }
    });
  })
);

// GET /api/crm/surveys/:id/commcraft-review
router.get('/:id/commcraft-review',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id)
      .populate('commcraftReview.reviewedBy', 'firstName lastName email')
      .lean();

    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    const responseCount = await SurveyResponse.countDocuments({ survey: survey._id });
    if (!responseCount) {
      return res.status(400).json({ success: false, message: 'Commcraft review is available after survey responses are received' });
    }

    res.json({
      success: true,
      data: {
        surveyId: survey._id,
        surveyTitle: survey.title,
        responseCount,
        review: serializeCommcraftReview(survey.commcraftReview)
      }
    });
  })
);

// PUT /api/crm/surveys/:id/commcraft-review
router.put('/:id/commcraft-review',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    const responseCount = await SurveyResponse.countDocuments({ survey: survey._id });
    if (!responseCount) {
      return res.status(400).json({ success: false, message: 'Commcraft review is available after survey responses are received' });
    }

    const payload = normalizeCommcraftReviewPayload(req.body);
    const now = new Date();
    const existing = survey.commcraftReview || {};

    survey.commcraftReview = {
      ...payload,
      reviewedBy: existing.reviewedBy || req.user._id,
      updatedBy: req.user._id,
      reviewedAt: now
    };

    await survey.save();
    await survey.populate('commcraftReview.reviewedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: 'Commcraft review saved',
      data: {
        surveyId: survey._id,
        review: serializeCommcraftReview(survey.commcraftReview)
      }
    });
  })
);

// POST /api/crm/surveys/:id/analysis-report
router.post('/:id/analysis-report',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: 'Survey not found' });
    if (!canManageSurvey(survey, req.user)) return res.status(403).json({ success: false, message: 'Not authorized' });

    const { findings, adviceToHigherManagement, recommendations, notVeryImportant, attachments } = req.body;

    survey.analysisReport = {
      ...(survey.analysisReport || {}),
      findings: findings || '',
      adviceToHigherManagement: adviceToHigherManagement || '',
      recommendations: recommendations || '',
      notVeryImportant: notVeryImportant || '',
      attachments: attachments || [],
      createdBy: req.user._id,
      updatedAt: new Date()
    };

    await survey.save();
    res.json({ success: true, data: survey.analysisReport });
  })
);

// POST /api/crm/surveys/:id/analysis-report/upload
router.post('/:id/analysis-report/upload',
  authorize(...CRM_ROLES),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    // Convert to relative URL
    const fileUrl = `/uploads/crm/surveys/${req.file.filename}`;
    res.json({ success: true, url: fileUrl, name: req.file.originalname });
  })
);

// POST /api/crm/surveys/:id/analysis-report/send
router.post('/:id/analysis-report/send',
  authorize(...CRM_ROLES),
  asyncHandler(async (req, res) => {
    const survey = await Survey.findById(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: 'Survey not found' });
    if (!canManageSurvey(survey, req.user)) return res.status(403).json({ success: false, message: 'Not authorized' });

    const { targetUsers } = req.body;

    if (!survey.analysisReport) {
      survey.analysisReport = { createdBy: req.user._id, updatedAt: new Date() };
    }

    survey.analysisReport.isSentToManagement = true;
    survey.analysisReport.sentAt = new Date();
    
    if (Array.isArray(targetUsers)) {
      survey.analysisReport.targetUsers = targetUsers;
    }

    await survey.save();

    // Create notifications for selected target users
    if (survey.analysisReport.targetUsers && survey.analysisReport.targetUsers.length > 0) {
      const notifications = survey.analysisReport.targetUsers.map(userId => ({
        recipient: userId,
        title: 'New Survey Analysis Report',
        message: `A new Survey Analysis Report for "${survey.title}" is available for your review.`,
        type: 'info',
        category: 'system',
        priority: 'high',
        actionUrl: '/crm/survey',
        actionText: 'View Dashboard',
        metadata: {
          module: 'crm',
          entityId: survey._id,
          entityType: 'Survey'
        },
        createdBy: req.user._id
      }));
      const savedNotifications = await Notification.insertMany(notifications);
      const realtimeNotificationGateway = require('../services/realtimeNotificationGateway');
      savedNotifications.forEach((n) => {
        realtimeNotificationGateway.emitToUser(String(n.recipient), 'notification:new', n);
      });
    }

    res.json({ success: true, message: 'Survey Analysis Report sent to higher management.', data: survey.analysisReport });
  })
);

module.exports = router;
