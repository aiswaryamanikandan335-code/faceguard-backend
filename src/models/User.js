const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ }, // India, without +91
    gender: { type: String, required: true, enum: ['Female', 'Male', 'Prefer not to say'] },
    passwordHash: { type: String, required: true },

    // The face photo lives in Cloudinary (private); only its id is stored here.
    face: {
      publicId: String,
      version: Number,
      format: String,
    },

    // Sign-in protection
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    tokenVersion: { type: Number, default: 0 }, // +1 on password reset: old login tokens stop working

    // Forgot password (6-digit code sent by email); only a hash of the code is stored
    resetOtpHash: String,
    resetOtpExpires: Date,
    resetOtpAttempts: { type: Number, default: 0 },
  },
  { timestamps: true } // createdAt = registration time, updatedAt
);

/** What the app is allowed to see. Never the password hash, lock or reset fields. */
userSchema.methods.publicProfile = function publicProfile(faceUrl) {
  return {
    id: this._id.toString(),
    fullName: this.fullName,
    email: this.email,
    phone: this.phone,
    gender: this.gender,
    createdAt: this.createdAt,
    faceUrl: faceUrl || null,
  };
};

module.exports = mongoose.model('User', userSchema);
