export default {
  maxConcurrency: 1,
  maxWorkers: 1,
  setupFilesAfterEnv: ["<rootDir>/env/setup-jest.js"],
  testMatch: ["<rootDir>/examples/**/*.test.js"],
  transform: {},
};
