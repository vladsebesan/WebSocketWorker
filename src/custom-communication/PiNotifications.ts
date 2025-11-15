import { NotificationMessage, type NotificationT, type FlowNotifyT } from '../generated/process-instance-message-api';
import type { IApiSubscription, IApiCommand } from './core/IApiInterfaces';
import { createApiFromSubscriptions } from './core/IApiInterfaces';
import { Api, type IFlowSubscribeParams, type IFlowSubscribeReply } from './PiRequests';

// Deserialized flow notification data
export interface IFlowNotificationData {
  subscriptionId: string; // Extracted from notification (assuming backend includes it)
  addedModules: any[];
  changedModules: any[];
  removedModules: string[];
  addedLinks: any[];
  removedLinks: string[];
  flowStateDetails: any;
}

// Flow subscription implementation
export class FlowSubscription implements IApiSubscription<IFlowSubscribeParams, IFlowSubscribeReply, IFlowNotificationData> {
  readonly subscriptionName = 'FlowSubscription';
  
  private notify: (data: IFlowNotificationData) => void;
  private onError?: (error: Error) => void;

  constructor(callback: (data: IFlowNotificationData) => void, onError?: (error: Error) => void) {
    this.notify = callback;
    this.onError = onError;
  }

  subscribe(params: IFlowSubscribeParams): IApiCommand<IFlowSubscribeParams, IFlowSubscribeReply> {
    return Api.FlowSubscribe(params);
  }

  unsubscribe(subscriptionId: string): IApiCommand<IFlowSubscribeParams, IFlowSubscribeReply> | null {
    return Api.FlowUnsubscribe({ subscriptionId: subscriptionId });
  }

  deserialize(notification: NotificationT): IFlowNotificationData | null {
    try {
      if (notification.messageType !== NotificationMessage.FlowNotify) {
        return null;
      }

      const flowNotify = notification.message as FlowNotifyT;
      
      // Assuming backend includes subscriptionId in the notification
      // This would need to be extracted from the notification payload
      // For now, we'll use sessionId as a placeholder
      const subscriptionId = notification.sessionId?.toString() || '';

      return {
        subscriptionId,
        addedModules: flowNotify.addedModules || [],
        changedModules: flowNotify.changedModules || [],
        removedModules: flowNotify.removedModules || [],
        addedLinks: flowNotify.addedLinks || [],
        removedLinks: flowNotify.removedLinks || [],
        flowStateDetails: flowNotify.flowStateDetails,
      };
    } catch (error) {
      if (this.onError) {
        const err = error instanceof Error ? error : new Error('Failed to deserialize flow notification');
        this.onError(err);
      }
      return null;
    }
  }

  // Expose callback for PiApi to invoke
//   public callNotify(data: IFlowNotificationData): void {
//     try {
//       this.notify(data);
//     } catch (error) {
//       if (this.onError) {
//         const err = error instanceof Error ? error : new Error('Error in subscription callback');
//         this.onError(err);
//       }
//     }
//   }
}

// Export subscription registry
export const Subscriptions = createApiFromSubscriptions({
  Flow: FlowSubscription,
});
