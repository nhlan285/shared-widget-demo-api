// src/utils/validators.js
const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === "string" && regex.test(email);
};

const validateDisplayName = (displayName) =>
  typeof displayName === "string" && displayName.trim().length > 0;

const validatePassword = (password) => {
  // Password should be at least 6 characters
  return typeof password === "string" && password.length >= 6;
};

module.exports = {
  validateEmail,
  validateDisplayName,
  validatePassword,
};
