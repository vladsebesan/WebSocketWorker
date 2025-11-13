// MainThreadClient - Handles sending messages back to the main thread
import type { IPIApiError, IPIApiState } from '../../shared/PIApiTypes';
import type { IPIApiWorkerResponse } from '../../shared/WorkerProtocol';

import { PIApiWorkerResponseType } from '../../shared/WorkerProtocol';

export class MainThreadClient {
  private postToMainThread(response: IPIApiWorkerResponse): void {
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  }

  public sendError(requestId: string, error: IPIApiError): void {
    const response: IPIApiWorkerResponse = {
      error,
      requestId,
      type: PIApiWorkerResponseType.ERROR,
    };
    this.postToMainThread(response);
  }

  public sendNotification<T>(notificationType: PIApiWorkerResponseType, data: T): void {
    const response = {
      data,
      type: notificationType,
    };
    this.postToMainThread(response as IPIApiWorkerResponse);
  }

  public sendStateChange(state: IPIApiState): void {
    const response: IPIApiWorkerResponse = {
      state,
      type: PIApiWorkerResponseType.STATE_CHANGED,
    };
    this.postToMainThread(response);
  }

  public sendSuccess<T>(requestId: string, data: T): void {
    const response: IPIApiWorkerResponse = {
      data,
      requestId,
      type: PIApiWorkerResponseType.SUCCESS,
    };
    this.postToMainThread(response);
  }
}
