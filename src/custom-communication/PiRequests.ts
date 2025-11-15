import { FlowGetReplyT, FlowGetT, FlowLinkEntryT, FlowModuleEntryT, FlowPortT, FlowStartType, FlowStateDetailsT, FlowSubscribeReplyT, FlowSubscribeT, type ReplyT, type ToolboxGetReplyT } from '../generated/process-instance-message-api';
import { ToolboxGetT } from '../generated/process-instance-message-api/toolbox-get';
import { type IFlowModel,type IFlowModule,type IToolboxEntry,type IToolboxModel,type IPort, Visibility, type IFlowModuleLink, type IFlowStateDetails, EnumFlowStartType } from '../interfaces/IFlow';
import { makeRequestMessageBuffer } from './core/FbbMessages';
import { createApiFromCommands, type IApiCommand } from './core/IApiInterfaces';

import {Visibility as FBVisibility} from '../generated/types-common-api';

export interface IToolboxGetParams {} // match the param of the fbs command
export class ToolboxGet implements IApiCommand<IToolboxGetParams, IToolboxModel> {
  readonly commandType = 'ToolboxGet';
  readonly params: IToolboxGetParams;
  constructor(params: IToolboxGetParams) {
    this.params = params;
  }

  serialize(requestId: string, sessionId: string): Uint8Array {
    const cmd = new ToolboxGetT();
    return makeRequestMessageBuffer(cmd, requestId, sessionId);
  }

  deserialize(reply: ReplyT): IToolboxModel | null {   
    const replyT = reply.message as ToolboxGetReplyT;
    let entries: IToolboxEntry[] = replyT.entries.map((e) => {
           return {
            categoryName: e.category.join('.'),
            description: e.description, 
            iconUrl: e.iconUrl,
            id: e.id,
            isLicensed: e.licensed,
            moduleName: e.name,
            moduleType:e.moduleType,
            version: e.version,
        } as IToolboxEntry;
    })
    return {entries} as IToolboxModel;
  }
}

export interface IFlowGetParams {} // match the param of the fbs command
export class FlowGet implements IApiCommand<IFlowGetParams, IFlowModel> {
  readonly commandType = 'FlowGet';
  readonly params: IFlowGetParams;
  constructor(params: IFlowGetParams) {
    this.params = params;
  }

  serialize(requestId: string, sessionId: string): Uint8Array {
    const cmd = new FlowGetT();
    return makeRequestMessageBuffer(cmd, requestId, sessionId);
  }

  static mapVisibilityEnum = (visibility: FBVisibility): Visibility => {
    switch(visibility) {
        case FBVisibility.EXTENDED:
            return Visibility.Extended;
        case FBVisibility.HIDDEN:
            return Visibility.Hidden;
        case FBVisibility.NORMAL:
            return Visibility.Normal;
        default:
          return Visibility.Hidden;
    }
  }

  static mapFlowStartTypeEnum = (type: FlowStartType): EnumFlowStartType => {
        switch(type) {
            case FlowStartType.START:
                return EnumFlowStartType.START;
            case FlowStartType.NEW_RUN:
                return EnumFlowStartType.NEW_RUN;
            case FlowStartType.REPEAT_RUN:
                return EnumFlowStartType.REPEAT_RUN;
            case FlowStartType.STOP:
                return EnumFlowStartType.STOP;
            default:
                break;
        }        
        return EnumFlowStartType.UNKNOWN;
    }

 static mapPort = (p: FlowPortT): IPort => {
    return {
        displayName: p.displayName,
        displayNameSuffix: p.nameSuffix,
        id: p.id,
        isDisabled: false,
        isLinkable: p.isLinkable,
        name: p.name,
        visibility: FlowGet.mapVisibilityEnum(p.visibility),
    } as IPort;
};

static mapFlowModule = (m: FlowModuleEntryT): IFlowModule => {
    const inputs : IPort[] = m.inputPorts!.items.map(FlowGet.mapPort);
    const outputs : IPort[] = m.outputPorts!.items.map(FlowGet.mapPort);        

    return {
        displayName: m.displayName,
        id: m.id,
        inputs: inputs,
        isCurrentlyRunning: m.isCurrentlyRunning,
        moduleType: m.moduleType,
        name: m.name,
        outputs: outputs,
        version: m.version,
        X: m.positionX,
        Y: m.positionY,
    } as IFlowModule;
}

static mapFlowStateDetails = (s: FlowStateDetailsT): IFlowStateDetails => {
    return {
        flowStartType: FlowGet.mapFlowStartTypeEnum(s.flowStartType),
        isAbortAllowed: s.isAbortAllowed,
        isNewRunAllowed: s.isNewRunAllowed,
        isRepeatRunAllowed: s.isRepeatRunAllowed,
        isStartAllowed: s.isStartAllowed,
        isStopAllowed: s.isStopAllowed,
    };
}

static mapFlowLink = (l: FlowLinkEntryT): IFlowModuleLink => {
    return {
        id: l.id,
        inputId: l.inputId,
        outputId: l.outputId,
        sourceModuleId: l.sourceModuleId,
        targetModuleId: l.targetModuleId,
    } as IFlowModuleLink;
}

  deserialize(reply: ReplyT): IFlowModel | null {   
    const replyT = reply.message as FlowGetReplyT;
    const modules : IFlowModule[] = replyT.modules.map(FlowGet.mapFlowModule);
    const links : IFlowModuleLink[] = replyT.links.map(FlowGet.mapFlowLink);
    const stateDetails : IFlowStateDetails = FlowGet.mapFlowStateDetails(replyT.flowStateDetails!);
    return {
        flowStateDetails: stateDetails,
        links: links,
        modules: modules,
    } as IFlowModel;
  }
}

export interface IFlowSubscribeParams {};
export interface IFlowSubscribeReply {subscriptionId: string;}
export class FlowSubscribe implements IApiCommand<IFlowSubscribeParams, IFlowSubscribeReply> {
  readonly commandType = 'FlowSubscribe';
  readonly params: IFlowSubscribeParams;
  constructor(params: IFlowSubscribeParams) {
    this.params = params;
  }

  serialize(requestId: string, sessionId: string): Uint8Array {
    const cmd = new FlowSubscribeT();
    return makeRequestMessageBuffer(cmd, requestId, sessionId);
  }


  deserialize(reply: ReplyT): IFlowSubscribeReply | null {   
    const replyT = reply.message as FlowSubscribeReplyT;  
    return {
        subscriptionId: replyT.subscriptionId,
    } as IFlowSubscribeReply;
  }
}

export const Api = createApiFromCommands({
  ToolboxGet,
  FlowGet,
  FlowSubscribe,
});

