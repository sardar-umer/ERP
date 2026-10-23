const express = require('express');
const router = express.Router();
const nonEmployeeController = require('../../controllers/hr/nonEmployeeController');
const { authMiddleware, authorize } = require('../../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads/non-employee-attachments');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'attachment-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { files: 40, fileSize: 15 * 1024 * 1024 }
});

// Ensure user is authenticated
router.use(authMiddleware);

// Routes — supports record-level `attachments` and per-row `employeeAttachments_0`, …
router.route('/')
  .post(upload.any(), nonEmployeeController.createRecord)
  .get(nonEmployeeController.getRecords);

// CEO Dashboard specific routes
router.get('/ceo-dashboard', nonEmployeeController.getForCEO);
router.put('/:id/approve-ceo', nonEmployeeController.approveByCEO);
router.put('/:id/reject-ceo', nonEmployeeController.rejectByCEO);
router.put('/:id/return-ceo', nonEmployeeController.returnByCEO);

// HOD Approval
router.put('/:id/approve-hod', nonEmployeeController.approveByHOD);
router.put('/:id/reject-hod', nonEmployeeController.rejectByHOD);

// Sr Director Approval
router.put('/:id/approve-sr-director', nonEmployeeController.approveBySrDirector);
router.put('/:id/reject-sr-director', nonEmployeeController.rejectBySrDirector);

// AVP Approval
router.put('/:id/approve-avp', nonEmployeeController.approveByAVP);
router.put('/:id/reject-avp', nonEmployeeController.rejectByAVP);

// Chairman Approval
router.put('/:id/approve-chairman', nonEmployeeController.approveByChairman);
router.put('/:id/reject-chairman', nonEmployeeController.rejectByChairman);

router.route('/:id')
  .get(nonEmployeeController.getRecordById)
  .put(upload.any(), nonEmployeeController.updateRecord)
  .delete(nonEmployeeController.deleteRecord);

module.exports = router;
