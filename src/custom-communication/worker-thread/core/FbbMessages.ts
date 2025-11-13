

// Generic helper to extract message union from any T class
// 1. searches for the types of accessor

import { Message, ProcessInstanceMessage, ProcessInstanceMessageT, ReplyT, RequestMessage, RequestT } from "../../../generated/process-instance-message-api";
import type { unionToMessage } from "../../../generated/process-instance-message-api/message";
import type { unionToRequestMessage } from "../../../generated/process-instance-message-api/request-message";
import * as flatbuffers from 'flatbuffers';
import { makeUUID } from "../../../utils/uuid";

// 2. for each of those returns the unpacked type
type IExtractUnionTypes<TFunc> = TFunc extends (
  type: any,
  accessor: (obj: infer U) => any,
  ...rest: any[]
) => any
  ? U extends { unpack(): infer K }
    ? K
    : never
  : never;

// Helper to get class name of object
// if object is a FlatBuffers TableT, removes the trailing T
const getObjectClassName = (obj: any): string => {
  let className = obj.constructor.name;
  if (className.endsWith('T')) {
    className = className.slice(0, -1);
  }
  return className;
};

// Deduced types
type IRequestUnionTypes = IExtractUnionTypes<typeof unionToRequestMessage>;
type IPiMessageUnionTypes = IExtractUnionTypes<typeof unionToMessage>;

// Thread-local builder instance
let builderInstance: flatbuffers.Builder | null = null;
const getBuilder = (): flatbuffers.Builder => {
  if (!builderInstance) {
    builderInstance = new flatbuffers.Builder(1024);
  } else {
    builderInstance.clear(); // Reset the builder state
  }
  return builderInstance;
};

const wrapRequest = (req: IRequestUnionTypes, reqId: string, sessionId: string): RequestT => {
  const request = new RequestT();
  request.sessionId = sessionId;
  request.messageType = (RequestMessage as any)[getObjectClassName(req)];
  request.requestId = reqId || makeUUID();
  request.message = req;
  return request;
};

const wrapAsPiMessage = (req: IPiMessageUnionTypes) => {
  const retVal = new ProcessInstanceMessageT();
  retVal.message = req;
  retVal.messageType = (Message as any)[getObjectClassName(req)];
  return retVal;
};

export const makeRequestMessageBuffer = (
  req: IRequestUnionTypes,
  reqId: string,
  sessionId: string,
): Uint8Array => {
  const piMessage = wrapAsPiMessage(wrapRequest(req, reqId, sessionId));
  const builder = getBuilder();
  const piMessageOffset = piMessage.pack(builder);
  builder.finish(piMessageOffset);
  return builder.asUint8Array();
};

export const unwrapPiMessageBuffer = (buffer: Uint8Array): null | ProcessInstanceMessageT => {
  try {
    const byteBuffer = new flatbuffers.ByteBuffer(buffer);
    const piMessage = ProcessInstanceMessage.getRootAsProcessInstanceMessage(byteBuffer);
    if (!piMessage) {
      return null;
    }
    return piMessage.unpack();
  } catch (error) {
    console.error('Failed to unwrap message buffer:', error);
    return null;
  }
};

export const tryUnwrapReply = (buffer: Uint8Array): null | ReplyT => {
  const piRoot = unwrapPiMessageBuffer(buffer);
  if (!!!piRoot) {
    console.log("wrong PI message format - can't unwrap");
    return null;
  }
  if (!!!piRoot.message) {
    console.log('PI message has no content');
    return null;
  }

  const piReply = piRoot.message as ReplyT;
  if (
    piReply.requestId === null ||
    piReply.sessionId === null ||
    piReply.status === null ||
    piReply.status!.code === null ||
    piReply.messageType === null ||
    piReply.message === null
  ) {
    console.log('PI reply is missing required fields');
    return null;
  }

  return piReply;
};

export interface IUnwrappedResult<T> {
  errorCode?: string;
  errorState: 'ERROR' | 'SUCCESS';
  payload?: T;
  requestId: string;
  sessionId: string;
}

export const tryUnwrapReplyOfType = <T>(
  buffer: Uint8Array,
  expectedClass: new (...args: unknown[]) => T,
): IUnwrappedResult<T> | null => {
  const reply = tryUnwrapReply(buffer);
  if (!!!reply) return null; // failed to unwrap reply
  if (!(reply.message instanceof expectedClass)) return null; // reply message is of different type than expected

  const isSuccess = reply.status!.code === 'SUCCESS';

  return {
    errorCode: reply.status!.code!.toString() || undefined,
    errorState: isSuccess ? 'SUCCESS' : 'ERROR',
    payload: isSuccess ? (reply.message as T) : undefined,
    requestId: reply.requestId!.toString(),
    sessionId: reply.sessionId!.toString(),
  };
};
