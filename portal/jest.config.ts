import type { Config } from "jest";
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@composio/core$": "<rootDir>/src/lib/__mocks__/composio-core.ts",
  },
};
export default config;
