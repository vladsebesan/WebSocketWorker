import type { ReplyT } from "../../generated/process-instance-message-api";

export interface IApiCommand<TParams, TResult> {
  readonly commandType: string;
  readonly params: TParams;
  serialize(requestId: string, sessionId: string): Uint8Array;
  deserialize(reply: ReplyT): TResult | null;
}

// Helper function to create command registry and API from class definitions
export function createApiFromCommands<T extends Record<string, new (params: any) => IApiCommand<any, any>>>(commands: T) {
  // Create factory functions
  const factories = {} as any;
  Object.entries(commands).forEach(([name, CommandClass]) => {
    factories[name] = (params: any = {}) => new CommandClass(params);
  });

  // Create search functions
  const findCommandByType = (commandType: string): T[keyof T] | undefined => {
    return Object.values(commands).find(CommandClass => {
      // Create temporary instance to check commandType
      const tempInstance = new CommandClass({});
      return tempInstance.commandType === commandType;
    }) as T[keyof T] | undefined;
  };

  const createCommandFromTransfer = (commandType: string, params: any): IApiCommand<any, any> => {
    const CommandClass = findCommandByType(commandType);
    if (!CommandClass) {
      throw new Error(`Unknown command type: ${commandType}`);
    }
    return new CommandClass(params);
  };

  return {
    ...factories,
    Commands: commands,
    findCommandByType,
    createCommandFromTransfer
  } as const;
}

