type IWebSocketProtocol = 'ws://' | 'wss://';
type IIPAddress = `${string}.${string}.${string}.${string}`;
type IPort = `${string}`;
type IPath = `/${string}`;
export type IWebSocketURL = '' | `${IWebSocketProtocol}${IIPAddress}:${IPort}${IPath}`;