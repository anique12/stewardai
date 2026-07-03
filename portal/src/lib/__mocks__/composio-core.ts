export class Composio {
  constructor(options?: { apiKey?: string }) {
    // Mock constructor
  }
  authConfigs = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    create: jest.fn().mockResolvedValue({ id: "mock-id" }),
  };
}
