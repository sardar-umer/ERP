const mongoose = require('mongoose');

const tajTransactionSchema = new mongoose.Schema(
  {
    // Resident account
    resident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TajResident',
      required: true
    },
    
    // Transaction Type
    transactionType: {
      type: String,
      enum: ['deposit', 'withdraw', 'transfer', 'payment', 'bill_payment'],
      required: true
    },
    
    // Amount
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    
    // For transfers - target resident
    targetResident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TajResident'
    },
    
    // For payments - reference to bill/charge
    referenceType: {
      type: String,
      enum: ['CAM', 'Electricity', 'Water', 'RENT', 'ELECTRICITY', 'Other', null]
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    referenceNumber: {
      type: String,
      trim: true
    },
    
    // Balance before and after transaction
    balanceBefore: {
      type: Number,
      required: true
    },
    balanceAfter: {
      type: Number,
      required: true
    },
    
    // Description/Notes
    description: {
      type: String,
      trim: true
    },
    
    // Payment method (for deposits/withdrawals)
    paymentMethod: {
      type: String,
      enum: ['Cash', 'Bank Transfer', 'Cheque', 'Online', 'Other']
    },
    bank: {
      type: String,
      trim: true // Bank name for bank transfer, cheque, online payments
    },
    referenceNumberExternal: {
      type: String,
      trim: true // External transaction reference (bank reference, cheque number, etc.)
    },

    // Charge type for deposits (CAM, WATER, ELECTRICITY, RENT, etc.)
    chargeType: {
      type: String,
      trim: true,
      uppercase: true,
      default: null
    },
    
    // For tracking deposit usage in bill payments (array to handle multiple deposits per payment)
    depositUsages: [{
      depositId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TajTransaction',
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      }
    }],
    
    // Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

// Indexes
tajTransactionSchema.index({ resident: 1, createdAt: -1 });
tajTransactionSchema.index({ transactionType: 1 });
tajTransactionSchema.index({ targetResident: 1 });
tajTransactionSchema.index({ referenceType: 1, referenceId: 1 });

module.exports = mongoose.model('TajTransaction', tajTransactionSchema);

