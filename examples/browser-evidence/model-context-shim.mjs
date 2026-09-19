export function createModelContextShim({ failAt } = {}) {
  const tools = new Map();
  const registrations = [];
  let registrationCount = 0;

  const serializeRecord = ({ name, optionsKeys, tool }) => ({
    annotations: { ...tool.annotations },
    description: tool.description,
    inputSchema: tool.inputSchema,
    name,
    optionsKeys: [...optionsKeys],
  });

  return Object.freeze({
    async registerTool(tool, options) {
      registrationCount += 1;
      if (registrationCount === failAt) throw new Error("injected registration failure");
      if (tools.has(tool.name)) throw new Error(`duplicate active tool: ${tool.name}`);
      const record = {
        name: tool.name,
        optionsKeys: Object.keys(options).sort(),
        tool,
      };
      tools.set(tool.name, record);
      registrations.push(record);
      options.signal.addEventListener("abort", () => {
        if (tools.get(tool.name) === record) tools.delete(tool.name);
      }, { once: true });
    },
    catalog() {
      return [...tools.values()].map(serializeRecord);
    },
    history() {
      return registrations.map(serializeRecord);
    },
    async invoke(name, input) {
      const registration = tools.get(name);
      if (!registration) throw new Error(`tool is not active: ${name}`);
      return registration.tool.execute(input);
    },
    registrationCount() {
      return registrations.length;
    },
  });
}
