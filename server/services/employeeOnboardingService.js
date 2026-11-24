const EmployeeOnboarding = require('../models/hr/EmployeeOnboarding');
const Employee = require('../models/hr/Employee');
const Candidate = require('../models/hr/Candidate');
const CandidateApproval = require('../models/hr/CandidateApproval');
const JoiningDocument = require('../models/hr/JoiningDocument');
const EmailService = require('./emailService');
const mongoose = require('mongoose');

class EmployeeOnboardingService {
  /**
   * Start onboarding process when joining document is submitted
   */
  async startOnboarding(approvalId) {
    try {
      console.log(`🚀 Starting employee onboarding for approval: ${approvalId}`);
      
      // Find the approval with related data
      const approval = await CandidateApproval.findById(approvalId)
        .populate('candidate')
        .populate({
          path: 'jobPosting',
          populate: [
            { path: 'department', select: 'name' },
            { path: 'location', select: 'name' }
          ]
        });
      
      if (!approval) {
        throw new Error('Approval not found');
      }
      
      // Find the joining document
      const joiningDocument = await JoiningDocument.findOne({ approvalId });
      if (!joiningDocument) {
        throw new Error('Joining document not found');
      }
      
      // Check if onboarding already exists
      let onboarding = await EmployeeOnboarding.findOne({ approvalId });
      if (onboarding) {
        console.log(`⚠️ Onboarding already exists for approval: ${approvalId}`);
        return onboarding;
      }
      
      // Create new onboarding record
      onboarding = new EmployeeOnboarding({
        approvalId: approval._id,
        joiningDocumentId: joiningDocument._id,
        status: 'pending'
      });
      
      await onboarding.save();
      console.log(`✅ Created onboarding record: ${onboarding._id}`);
      
      // Send onboarding email to candidate
      await this.sendOnboardingEmail(onboarding);
      
      // Send notification to HR (simplified for now)
      await this.notifyHR(onboarding);
      
      return onboarding;
    } catch (error) {
      console.error(`❌ Error starting onboarding:`, error);
      throw error;
    }
  }
  
  /**
   * Send onboarding email to candidate
   */
  async sendOnboardingEmail(onboarding) {
    try {
      const approval = await CandidateApproval.findById(onboarding.approvalId)
        .populate('candidate')
        .populate({
          path: 'jobPosting',
          populate: [
            { path: 'department', select: 'name' },
            { path: 'location', select: 'name' }
          ]
        });
      
      const emailResult = await EmailService.sendEmployeeOnboardingEmail(approval, onboarding);
      
      if (emailResult.success) {
        onboarding.onboardingEmailSent = true;
        onboarding.onboardingEmailSentAt = new Date();
        await onboarding.save();
        console.log(`✅ Onboarding email sent successfully`);
      } else {
        console.log(`⚠️ Failed to send onboarding email:`, emailResult.error);
      }
    } catch (error) {
      console.error(`❌ Error sending onboarding email:`, error);
    }
  }
  
  /**
   * Notify HR about new onboarding (simplified)
   */
  async notifyHR(onboarding) {
    try {
      const approval = await CandidateApproval.findById(onboarding.approvalId)
        .populate('candidate')
        .populate({
          path: 'jobPosting',
          populate: [
            { path: 'department', select: 'name' },
            { path: 'location', select: 'name' }
          ]
        });
      
      // For now, just log the notification instead of using the notification service
      console.log(`🔔 HR Notification: New employee onboarding started for ${approval.candidate.firstName} ${approval.candidate.lastName}`);
      console.log(`📋 Onboarding ID: ${onboarding._id}`);
      console.log(`👤 Candidate: ${approval.candidate.firstName} ${approval.candidate.lastName}`);
      console.log(`💼 Position: ${approval.jobPosting?.title || 'N/A'}`);
      console.log(`🏢 Department: ${approval.jobPosting?.department?.name || 'N/A'}`);
      
      // TODO: Implement proper HR notification when notification service is ready
      // await NotificationService.createNotification({...});
      
      console.log(`✅ HR notification logged for onboarding: ${onboarding._id}`);
    } catch (error) {
      console.error(`❌ Error notifying HR:`, error);
    }
  }
  
  /**
   * Process onboarding form submission - Now uses Employee model directly
   */
  async processOnboardingForm(onboardingId, formData) {
    try {
      console.log(`🔄 Processing onboarding form for onboarding ID: ${onboardingId}`);
      console.log('Form data received:', formData);
      
      // Find the onboarding record
      let onboarding = await EmployeeOnboarding.findById(onboardingId)
        .populate({
          path: 'approvalId',
          populate: {
            path: 'candidate',
            select: 'firstName lastName email phone dateOfBirth gender nationality'
          }
        });
      
      // If not found by direct ID, try to find by approvalId
      if (!onboarding) {
        console.log(`🔍 Not found by direct ID, trying to find by approvalId: ${onboardingId}`);
        onboarding = await EmployeeOnboarding.findOne({ approvalId: onboardingId })
          .populate({
            path: 'approvalId',
            populate: {
              path: 'candidate',
              select: 'firstName lastName email phone dateOfBirth gender nationality'
            }
          });
      }
      
      if (!onboarding) {
        throw new Error('Onboarding record not found. Please ensure the approval process is complete.');
      }
      
      console.log(`✅ Found onboarding record: ${onboarding._id}`);
      
      // Validate that approval and candidate information is properly loaded
      if (!onboarding.approvalId || !onboarding.approvalId.candidate) {
        console.log('❌ Approval or candidate information not properly populated:', onboarding);
        
        // Try to manually fetch the approval data
        console.log('🔍 Attempting to manually fetch approval data for:', onboarding.approvalId);
        
        // For now, just throw an error - the candidate should be properly linked
        throw new Error('Candidate information not found. Please ensure the approval process is complete.');
      }
      
      const candidate = onboarding.approvalId.candidate;
      console.log(`✅ Candidate information loaded: ${candidate.firstName} ${candidate.lastName}`);
      
      // Update onboarding status and notes
      onboarding.status = 'in_progress';
      onboarding.notes = formData.notes || 'Onboarding form submitted';
      
      // Update onboarding tasks status
      if (onboarding.onboardingTasks && onboarding.onboardingTasks.length > 0) {
        onboarding.onboardingTasks.forEach(task => {
          if (task.taskName === 'Complete Personal Information') {
            task.status = 'completed';
            task.completedDate = new Date();
          }
        });
      }
      
      await onboarding.save();
      console.log(`✅ Onboarding updated: ${onboarding._id}`);
      
      // Now create the employee record using the Employee model directly
      console.log(`👤 Creating employee record from onboarding form...`);
      
      const employee = await this.createEmployeeFromOnboardingForm(formData, candidate, onboarding.approvalId._id);
      
      // Link the employee to the onboarding record
      onboarding.employeeId = employee._id;
      onboarding.status = 'completed';
      await onboarding.save();
      
      console.log(`✅ Employee created and linked to onboarding: ${employee._id}`);
      
      // Create notification for HR team about completed onboarding
      try {
        const NotificationService = require('./notificationService');
        await NotificationService.createEmployeeOnboardingNotification(
          employee,
          onboarding.approvalId.jobPosting,
          onboarding.approvalId
        );
        console.log(`✅ HR notification created for completed onboarding: ${onboarding._id}`);
      } catch (notificationError) {
        console.error(`❌ Failed to create HR notification:`, notificationError.message);
        // Continue with the process even if notification fails
      }
      
      return {
        success: true,
        message: 'Onboarding form processed successfully. Employee record created.',
        data: {
          onboardingId: onboarding._id,
          employeeId: employee._id,
          employee: {
            id: employee._id,
            employeeId: employee.employeeId,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            status: employee.status
          }
        }
      };
      
    } catch (error) {
      console.error('❌ Error processing onboarding form:', error);
      throw error;
    }
  }
  
  /**
   * Create employee record directly from onboarding form data using Employee model
   */
  async createEmployeeFromOnboardingForm(formData, candidate, approvalId) {
    try {
      console.log(`🔧 Creating employee record from form data...`);
      
      // Check if employee already exists for this approval
      const existingEmployee = await Employee.findOne({ approvalId: approvalId });
      if (existingEmployee) {
        console.log(`✅ Employee already exists for this approval: ${existingEmployee._id}`);
        // Update the existing employee with new form data
        return await this.updateExistingEmployee(existingEmployee, formData, candidate);
      }
      
      // Generate next employee ID
      const nextEmployeeId = await this.getNextEmployeeId();
      
      // Helper function to convert string to ObjectId if needed
      const toObjectId = (value) => {
        if (!value) return null;
        if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
          return new mongoose.Types.ObjectId(value);
        }
        return value;
      };
      
      // Create new employee using Employee model structure
      const employee = new Employee({
        // Basic Information
        employeeId: nextEmployeeId,
        firstName: formData.firstName || candidate.firstName,
        lastName: formData.lastName || candidate.lastName,
        email: formData.email || candidate.email,
        phone: formData.phone || candidate.phone,
        dateOfBirth: formData.dateOfBirth ? new Date(formData.dateOfBirth) : candidate.dateOfBirth,
        gender: formData.gender || candidate.gender,
        idCard: formData.idCard,
        nationality: formData.nationality || candidate.nationality,
        religion: formData.religion || 'Islam',
        maritalStatus: formData.maritalStatus || 'Single',
        guardianName: formData.guardianName || formData.fatherName || '',
        
        // Address Information
        address: {
          street: formData.address?.street || 'To be provided',
          city: toObjectId(formData.address?.city),
          state: toObjectId(formData.address?.state),
          country: toObjectId(formData.address?.country)
        },
        
        // Emergency Contact
        emergencyContact: {
          name: formData.emergencyContact?.name || 'To be provided',
          relationship: formData.emergencyContact?.relationship || 'To be provided',
          phone: formData.emergencyContact?.phone || 'To be provided',
          email: formData.emergencyContact?.email || null
        },
        
        // Employment Information
        department: toObjectId(formData.department),
        position: toObjectId(formData.position),
        hireDate: formData.joiningDate ? new Date(formData.joiningDate) : new Date(),
        employmentType: formData.employmentType || 'Full-time',
        probationPeriodMonths: formData.probationPeriod || 3,
        employmentStatus: 'Draft', // Start as draft, will be activated by HR
        
        // Salary Information
        salary: {
          gross: parseFloat(formData.salary) || 0,
          basic: parseFloat(formData.salary) ? Math.round(parseFloat(formData.salary) * 0.6) : 0 // 60% of gross as basic
        },
        currency: 'PKR',
        
        // Benefits
        benefits: {
          healthInsurance: false,
          dentalInsurance: false,
          visionInsurance: false,
          lifeInsurance: false,
          retirementPlan: false
        },
        
        // EOBI and Provident Fund
        eobi: {
          isActive: true,
          amount: 0,
          percentage: 1
        },
        providentFund: {
          isActive: true,
          amount: 0,
          percentage: 8.34
        },
        
        // Reference to approval and onboarding
        approvalId: approvalId,
        
        // Status
        status: 'inactive', // Start as inactive, will be activated by HR
        onboardingStatus: 'completed'
      });
      
      await employee.save();
      console.log(`✅ Employee record created successfully: ${employee._id}`);
      console.log(`   Employee ID: ${employee.employeeId}`);
      console.log(`   Name: ${employee.firstName} ${employee.lastName}`);
      console.log(`   Email: ${employee.email}`);
      console.log(`   Status: ${employee.status}`);
      
      return employee;
      
    } catch (error) {
      console.error('❌ Error creating employee from onboarding form:', error);
      throw error;
    }
  }
  
  /**
   * Update existing employee with new form data
   */
  async updateExistingEmployee(employee, formData, candidate) {
    try {
      console.log(`🔧 Updating existing employee: ${employee._id}`);
      
      // Helper function to convert string to ObjectId if needed
      const toObjectId = (value) => {
        if (!value) return null;
        if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
          return new mongoose.Types.ObjectId(value);
        }
        return value;
      };
      
      // Update basic information
      if (formData.firstName) employee.firstName = formData.firstName;
      if (formData.lastName) employee.lastName = formData.lastName;
      if (formData.email) employee.email = formData.email;
      if (formData.phone) employee.phone = formData.phone;
      if (formData.dateOfBirth) employee.dateOfBirth = new Date(formData.dateOfBirth);
      if (formData.gender) employee.gender = formData.gender;
      if (formData.idCard) employee.idCard = formData.idCard;
      if (formData.nationality) employee.nationality = formData.nationality;
      
      // Update address
      if (formData.address?.street) employee.address.street = formData.address.street;
      if (formData.address?.city) employee.address.city = toObjectId(formData.address.city);
      if (formData.address?.state) employee.address.state = toObjectId(formData.address.state);
      if (formData.address?.country) employee.address.country = toObjectId(formData.address.country);
      
      // Update emergency contact
      if (formData.emergencyContact?.name) employee.emergencyContact.name = formData.emergencyContact.name;
      if (formData.emergencyContact?.relationship) employee.emergencyContact.relationship = formData.emergencyContact.relationship;
      if (formData.emergencyContact?.phone) employee.emergencyContact.phone = formData.emergencyContact.phone;
      if (formData.emergencyContact?.email) employee.emergencyContact.email = formData.emergencyContact.email;
      
      // Update employment information
      if (formData.department) employee.department = toObjectId(formData.department);
      if (formData.position) employee.position = toObjectId(formData.position);
      if (formData.joiningDate) employee.hireDate = new Date(formData.joiningDate);
      if (formData.employmentType) employee.employmentType = formData.employmentType;
      if (formData.probationPeriod) employee.probationPeriodMonths = formData.probationPeriod;
      
      // Update salary
      if (formData.salary) {
        const salary = parseFloat(formData.salary);
        if (!isNaN(salary)) {
          employee.salary.gross = salary;
          employee.salary.basic = Math.round(salary * 0.6);
        }
      }
      
      // Update onboarding status
      employee.onboardingStatus = 'completed';
      
      await employee.save();
      console.log(`✅ Employee updated successfully: ${employee._id}`);
      
      return employee;
      
    } catch (error) {
      console.error('❌ Error updating existing employee:', error);
      throw error;
    }
  }

  /**
   * Get next sequential employee ID
   */
  async getNextEmployeeId() {
    try {
      const lastEmployee = await Employee.findOne().setOptions({ includeUnapproved: true }).sort({ employeeId: -1 });
      
      if (!lastEmployee || !lastEmployee.employeeId) {
        return '1001'; // Start with 1001 if no employees exist
      }
      
      // Extract numeric part and increment
      const lastId = parseInt(lastEmployee.employeeId);
      const nextId = lastId + 1;
      
      return nextId.toString();
    } catch (error) {
      console.error('❌ Error generating next employee ID:', error);
      // Fallback to timestamp-based ID
      return `EMP${Date.now()}`;
    }
  }
  
  /**
   * Activate employee (change status from inactive to active)
   */
  async activateEmployee(employeeId, activatedBy) {
    try {
      console.log(`🚀 Activating employee: ${employeeId}`);
      
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        throw new Error('Employee not found');
      }
      
      if (employee.status === 'active') {
        throw new Error('Employee is already active');
      }
      
      // Activate employee
      employee.status = 'active';
      employee.employmentStatus = 'Active';
      employee.activatedAt = new Date();
      employee.activatedBy = activatedBy;
      
      await employee.save();
      
      // Update onboarding status
      await EmployeeOnboarding.findOneAndUpdate(
        { employeeId: employeeId },
        { status: 'completed' }
      );
      
      // Send notification
      await this.notifyEmployeeActivated(employee);
      
      console.log(`✅ Employee activated successfully: ${employee._id}`);
      return employee;
      
    } catch (error) {
      console.error(`❌ Error activating employee:`, error);
      throw error;
    }
  }
  
  /**
   * Notify when employee is activated
   */
  async notifyEmployeeActivated(employee) {
    try {
      console.log(`📧 Sending employee activation notification...`);
      
      // Create notification for HR
      const Notification = require('../models/hr/Notification');
      const notification = new Notification({
        title: 'Employee Activated',
        message: `Employee ${employee.firstName} ${employee.lastName} has been activated and is now part of the team.`,
        type: 'employee_activation',
        recipient: 'hr_team',
        data: {
          employeeId: employee._id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          department: employee.department,
          position: employee.position
        }
      });
      
      await notification.save();
      console.log(`✅ Activation notification sent`);
      
    } catch (error) {
      console.error(`❌ Error sending activation notification:`, error);
      // Don't throw error - notification failure shouldn't stop activation
    }
  }
  
  /**
   * Notify HR that onboarding is complete (simplified)
   */
  async notifyHROnboardingComplete(onboarding) {
    try {
      const approval = await CandidateApproval.findById(onboarding.approvalId)
        .populate('candidate')
        .populate({
          path: 'jobPosting',
          populate: [
            { path: 'department', select: 'name' },
            { path: 'location', select: 'name' }
          ]
        });
      
      // For now, just log the notification
      console.log(`🔔 HR Notification: Employee onboarding completed for ${approval.candidate.firstName} ${approval.candidate.lastName}`);
      console.log(`✅ Employee created with ID: ${onboarding.employeeId}`);
      console.log(`📋 Onboarding ID: ${onboarding._id}`);
      console.log(`👤 Candidate: ${approval.candidate.firstName} ${approval.candidate.lastName}`);
      console.log(`💼 Position: ${approval.jobPosting?.title || 'N/A'}`);
      console.log(`🏢 Department: ${approval.jobPosting?.department?.name || 'N/A'}`);
      
      // TODO: Implement proper HR notification when notification service is ready
      // await NotificationService.createNotification({...});
      
      console.log(`✅ HR notification logged for onboarding: ${onboarding._id}`);
    } catch (error) {
      console.error(`❌ Error notifying HR of completion:`, error);
    }
  }
  
  /**
   * Get onboarding details for public access
   */
  async getPublicOnboarding(onboardingId) {
    try {
      console.log(`🔍 Getting public onboarding for ID: ${onboardingId}`);
      console.log(`🔍 Type of onboardingId: ${typeof onboardingId}`);
      
      // First try to find by direct ID
      let onboarding = await EmployeeOnboarding.findById(onboardingId)
        .populate({
          path: 'approvalId',
          populate: {
            path: 'candidate',
            select: 'firstName lastName email phone dateOfBirth gender nationality'
          }
        })
        .populate('employeeId');
      
      // If not found by direct ID, try to find by approvalId
      if (!onboarding) {
        console.log(`🔍 Not found by direct ID, trying to find by approvalId: ${onboardingId}`);
        onboarding = await EmployeeOnboarding.findOne({ approvalId: onboardingId })
          .populate({
            path: 'approvalId',
            populate: {
              path: 'candidate',
              select: 'firstName lastName email phone dateOfBirth gender nationality'
            }
          })
          .populate('employeeId');
      }
      
      // If still not found, check if this is an approval ID and create a placeholder onboarding
      if (!onboarding) {
        console.log(`🔍 No onboarding found, checking if this is an approval ID: ${onboardingId}`);
        const CandidateApproval = require('../models/hr/CandidateApproval');
        const approval = await CandidateApproval.findById(onboardingId)
          .populate('candidate')
          .populate({
            path: 'jobPosting',
            populate: [
              { path: 'department', select: 'name' },
              { path: 'location', select: 'name' }
            ]
          });
        
        if (approval && approval.status === 'approved') {
          console.log(`🔍 Found approved approval, creating placeholder onboarding`);
          onboarding = await this.createPlaceholderOnboarding(approval);
        }
      }
      
      console.log(`🔍 Onboarding found:`, onboarding);
      
      if (!onboarding) {
        console.log(`❌ No onboarding found for ID: ${onboardingId}`);
        throw new Error('Onboarding not found. Please complete the joining document first.');
      }
      
      console.log(`✅ Onboarding retrieved successfully:`, onboarding._id);
      
      return { success: true, data: onboarding };
    } catch (error) {
      console.error(`❌ Error getting public onboarding:`, error);
      throw error;
    }
  }

  /**
   * Create a placeholder onboarding record for approved candidates
   */
  async createPlaceholderOnboarding(approval) {
    try {
      console.log(`🔧 Creating placeholder onboarding for approval: ${approval._id}`);
      
      const EmployeeOnboarding = require('../models/hr/EmployeeOnboarding');
      
      // Check if onboarding already exists
      const existingOnboarding = await EmployeeOnboarding.findOne({ approvalId: approval._id });
      if (existingOnboarding) {
        console.log(`✅ Onboarding already exists: ${existingOnboarding._id}`);
        return existingOnboarding;
      }
      
      // Create placeholder onboarding with all required fields
      const placeholderOnboarding = new EmployeeOnboarding({
        approvalId: approval._id,
        employeeId: null, // Will be set when employee is created
        status: 'pending',
        createdBy: approval.createdBy || null,
        // Add some default onboarding tasks
        onboardingTasks: [
          {
            taskName: 'Complete Personal Information',
            description: 'Fill out personal details form',
            status: 'pending'
          },
          {
            taskName: 'Submit Documents',
            description: 'Upload required documents',
            status: 'pending'
          },
          {
            taskName: 'System Access Setup',
            description: 'Setup email, system access, and equipment',
            status: 'pending'
          }
        ]
      });
      
      await placeholderOnboarding.save();
      console.log(`✅ Placeholder onboarding created: ${placeholderOnboarding._id}`);
      
      return placeholderOnboarding;
    } catch (error) {
      console.error(`❌ Error creating placeholder onboarding:`, error);
      throw error;
    }
  }
  
  /**
   * Get all onboarding records for HR
   */
  async getAllOnboarding(filters = {}) {
    try {
      const query = {};
      
      if (filters.status) query.status = filters.status;
      if (filters.approvalId) query.approvalId = filters.approvalId;
      
      const onboarding = await EmployeeOnboarding.find(query)
        .populate('approvalId')
        .populate('employeeId', 'firstName lastName')
        .sort({ createdAt: -1 });
      
      return { success: true, data: onboarding };
    } catch (error) {
      console.error(`❌ Error getting onboarding records:`, error);
      throw error;
    }
  }
}

module.exports = new EmployeeOnboardingService();