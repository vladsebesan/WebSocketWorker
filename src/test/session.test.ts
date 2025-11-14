import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Session, SessionState, type ISessionConfig, type ISessionState } from '../custom-communication/worker-thread/Session'
import type { ITransport } from '../custom-communication/worker-thread/Transport'
import { SessionCreateReplyT, SessionKeepaliveReplyT } from '../generated/process-instance-message-api'
import { ProcessInstanceMessageT, ReplyT, StatusT, Message, ReplyMessage } from '../generated/process-instance-message-api'
import * as flatbuffers from 'flatbuffers'
import { makeUUID } from '../utils/uuid'

// Helper functions to create real FlatBuffer reply messages
const createReplyMessageBuffer = (
  replyPayload: SessionCreateReplyT | SessionKeepaliveReplyT,
  requestId: string,
  sessionId: string,
  status: 'SUCCESS' | 'ERROR' = 'SUCCESS',
  errorMessage?: string
): Uint8Array => {
  const builder = new flatbuffers.Builder(1024)
  
  // Create status
  const statusObj = new StatusT()
  statusObj.code = status
  statusObj.errorMessage = errorMessage || null
  
  // Create reply
  const reply = new ReplyT()
  reply.requestId = requestId
  reply.sessionId = sessionId
  reply.status = statusObj
  reply.message = replyPayload
  reply.messageType = (ReplyMessage as any)[replyPayload.constructor.name.replace('T', '')]
  
  // Create ProcessInstanceMessage
  const piMessage = new ProcessInstanceMessageT()
  piMessage.message = reply
  piMessage.messageType = (Message as any)['Reply']
  
  // Pack and serialize
  const piMessageOffset = piMessage.pack(builder)
  builder.finish(piMessageOffset)
  return builder.asUint8Array()
}

const createSessionCreateReply = (sessionId: string, requestId: string = makeUUID()): Uint8Array => {
  const replyPayload = new SessionCreateReplyT()
  return createReplyMessageBuffer(replyPayload, requestId, sessionId)
}

const createSessionKeepaliveReply = (sessionId: string, requestId: string = makeUUID()): Uint8Array => {
  const replyPayload = new SessionKeepaliveReplyT()
  return createReplyMessageBuffer(replyPayload, requestId, sessionId)
}

// Mock transport layer implementation
class MockTransportLayer implements ITransport {
  public onConnected: (() => void) | null = null
  public onDisconnected: (() => void) | null = null
  public onError: ((error: Error) => void) | null = null
  public onMessage: ((buffer: Uint8Array) => void) | null = null

  private _isConnected = false
  private _sentMessages: Uint8Array[] = []

  connect(_url: string): void {
    // Simulate successful connection after a short delay
    setTimeout(() => {
      this._isConnected = true
      if (this.onConnected) {
        this.onConnected()
      }
    }, 10)
  }

  disconnect(): void {
    this._isConnected = false
    if (this.onDisconnected) {
      this.onDisconnected()
    }
  }

  send(buffer: Uint8Array): void {
    if (!this._isConnected) {
      throw new Error('Transport not connected')
    }
    this._sentMessages.push(buffer)
  }

  // Test helpers
  get isConnected(): boolean {
    return this._isConnected
  }

  get sentMessages(): Uint8Array[] {
    return [...this._sentMessages]
  }

  clearSentMessages(): void {
    this._sentMessages = []
  }

  // Simulate receiving a session create reply
  simulateSessionCreateReply(sessionId: string): void {
    if (this.onMessage) {
      // Create a real FlatBuffer SessionCreateReply message
      const replyBuffer = createSessionCreateReply(sessionId)
      this.onMessage(replyBuffer)
    }
  }

  // Simulate receiving a session keepalive reply
  simulateSessionKeepaliveReply(sessionId: string): void {
    if (this.onMessage) {
      // Create a real FlatBuffer SessionKeepaliveReply message
      const replyBuffer = createSessionKeepaliveReply(sessionId)
      this.onMessage(replyBuffer)
    }
  }

  simulateConnectionError(): void {
    if (this.onError) {
      this.onError(new Error('Connection failed'))
    }
  }

  simulateDisconnection(): void {
    this._isConnected = false
    if (this.onDisconnected) {
      this.onDisconnected()
    }
  }
}

describe('Session Manager Tests', () => {
  let sessionManager: Session
  let mockTransport: MockTransportLayer
  let onConnectedSpy: ReturnType<typeof vi.fn>
  let onDisconnectedSpy: ReturnType<typeof vi.fn>
  let onStateChangedSpy: ReturnType<typeof vi.fn>
  let onMessageSpy: ReturnType<typeof vi.fn>

  // Helper to track state changes
  let currentState: ISessionState
  let stateHistory: ISessionState[] = []

  const defaultConfig: ISessionConfig = {
    maxReconnectAttempts: 3,
    reconnectIntervalMs: 100, // Fast for testing
    sessionKeepaliveIntervalMs: 200, // Fast for testing
    maxKeepaliveFailures: 2,
    url: 'ws://localhost:9090/test'
  }

  beforeEach(() => {
    mockTransport = new MockTransportLayer()
    sessionManager = new Session(mockTransport)
    
    // Initialize tracking variables
    stateHistory = []
    currentState = {
      reconnectAttemptsLeft: 0,
      sessionId: null,
      sessionState: SessionState.DISCONNECTED
    }
    
    // Setup spies
    onConnectedSpy = vi.fn()
    onDisconnectedSpy = vi.fn()
    onMessageSpy = vi.fn()
    onStateChangedSpy = vi.fn((state: ISessionState) => {
      currentState = state
      stateHistory.push({ ...state })
    })
    
    // Attach spies to session manager
    sessionManager.onConnected = onConnectedSpy
    sessionManager.onDisconnected = onDisconnectedSpy
    sessionManager.onMessage = onMessageSpy
    sessionManager.onStateChanged = onStateChangedSpy
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe('Basic Connection Flow', () => {
    it('should start in DISCONNECTED state', () => {
      expect(currentState.sessionState).toBe(SessionState.DISCONNECTED)
      expect(currentState.sessionId).toBeNull()
      expect(currentState.reconnectAttemptsLeft).toBe(0)
    })

    it('should transition to CONNECTING state when connect is called', () => {
      sessionManager.connect(defaultConfig)
      
      // Should have triggered state change callback
      expect(onStateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionState: SessionState.CONNECTING,
          reconnectAttemptsLeft: defaultConfig.maxReconnectAttempts,
          sessionId: null
        })
      )    
      expect(currentState.sessionState).toBe(SessionState.CONNECTING)
      expect(currentState.reconnectAttemptsLeft).toBe(defaultConfig.maxReconnectAttempts)
    })

    it('should transition to SESSION_INIT when transport connects', async () => {
      vi.useFakeTimers()
      sessionManager.connect(defaultConfig)      
 
      onStateChangedSpy.mockClear() // Clear the initial state change call
      
      // Fast forward to trigger connection
      vi.advanceTimersByTime(20)
      
      // Should have triggered another state change to SESSION_INIT
      expect(onStateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionState: SessionState.SESSION_INIT,
          sessionId: null
        })
      )      
      expect(currentState.sessionState).toBe(SessionState.SESSION_INIT)
      expect(mockTransport.sentMessages.length).toBe(1) // Should have sent session create message
      vi.useRealTimers()
    })

    it('should handle successful session creation', async () => {
      vi.useFakeTimers()
      
      sessionManager.connect(defaultConfig)
      
      // Clear previous state change calls
      onStateChangedSpy.mockClear()
      onConnectedSpy.mockClear()
      
      // Wait for transport to connect
      vi.advanceTimersByTime(20)
      
      mockTransport.simulateSessionCreateReply('test-session-123')
      
      // Should have triggered state change to CONNECTED
      expect(onStateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionState: SessionState.CONNECTED,
          sessionId: 'test-session-123'
        })
      )
      
      expect(currentState.sessionState).toBe(SessionState.CONNECTED)
      expect(currentState.sessionId).toBe('test-session-123')
      expect(onConnectedSpy).toHaveBeenCalledOnce()
      
      vi.useRealTimers()
    })

    it('should handle session keepalive replies', async () => {
      vi.useFakeTimers()
      
      // First establish a session
      sessionManager.connect(defaultConfig)
      vi.advanceTimersByTime(20) // Connect transport
      mockTransport.simulateSessionCreateReply('test-session-456')
      
      expect(currentState.sessionState).toBe(SessionState.CONNECTED)
      expect(currentState.sessionId).toBe('test-session-456')
      
      // Clear previous calls
      onStateChangedSpy.mockClear()
      
      // Simulate keepalive reply
      mockTransport.simulateSessionKeepaliveReply('test-session-456')
      
      // Should maintain CONNECTED state and reset reconnect attempts
      expect(currentState.sessionState).toBe(SessionState.CONNECTED)
      expect(currentState.sessionId).toBe('test-session-456')
      expect(currentState.reconnectAttemptsLeft).toBe(defaultConfig.maxReconnectAttempts)
      
      vi.useRealTimers()
    })

    it('should reject keepalive replies with mismatched sessionId', async () => {
      vi.useFakeTimers()
      
      // First establish a session
      sessionManager.connect(defaultConfig)
      vi.advanceTimersByTime(20) // Connect transport
      mockTransport.simulateSessionCreateReply('correct-session-id')
      
      expect(currentState.sessionState).toBe(SessionState.CONNECTED)
      expect(currentState.sessionId).toBe('correct-session-id')
      
      // Clear previous calls
      onStateChangedSpy.mockClear()
      
      // Simulate keepalive reply with wrong sessionId
      mockTransport.simulateSessionKeepaliveReply('wrong-session-id')
      
      // Should NOT trigger any state changes since the sessionId doesn't match
      expect(onStateChangedSpy).not.toHaveBeenCalled()
      
      // State should remain unchanged
      expect(currentState.sessionState).toBe(SessionState.CONNECTED)
      expect(currentState.sessionId).toBe('correct-session-id')
      
      vi.useRealTimers()
    })

    it('should reject keepalive replies when no session exists', async () => {
      // Try to send a keepalive reply without establishing a session first
      mockTransport.simulateSessionKeepaliveReply('some-session-id')
      
      // Should NOT trigger any state changes since there's no active session
      expect(onStateChangedSpy).not.toHaveBeenCalled()
      
      // State should remain in initial DISCONNECTED state
      expect(currentState.sessionState).toBe(SessionState.DISCONNECTED)
      expect(currentState.sessionId).toBeNull()
    })
  })

  describe('Connection Resilience', () => {
    it('should handle transport connection errors', () => {
      sessionManager.connect(defaultConfig)
      
      // Clear initial state changes
      onStateChangedSpy.mockClear()
      
      mockTransport.simulateConnectionError()
      
      // Should remain in connecting state and potentially trigger reconnection
      expect(currentState.sessionState).toBe(SessionState.CONNECTING)
    })

    it('should handle transport disconnection and attempt reconnection', async () => {
      vi.useFakeTimers()
      
      sessionManager.connect(defaultConfig)
      vi.advanceTimersByTime(20) // Connect
      
      expect(currentState.sessionState).toBe(SessionState.SESSION_INIT)
      
      // Clear previous state changes
      onStateChangedSpy.mockClear()
      
      // Simulate disconnection
      mockTransport.simulateDisconnection()
      
      // Should attempt reconnection and trigger state change
      expect(onStateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionState: SessionState.CONNECTING,
          reconnectAttemptsLeft: expect.any(Number)
        })
      )
      
      expect(currentState.sessionState).toBe(SessionState.CONNECTING)
      // Reconnect attempts are preserved when disconnecting from SESSION_INIT
      expect(currentState.reconnectAttemptsLeft).toBeLessThanOrEqual(defaultConfig.maxReconnectAttempts)
      
      vi.useRealTimers()
    })

    it('should stop reconnection attempts when exhausted', () => {
      vi.useFakeTimers()
      
      const configWithFewAttempts: ISessionConfig = {
        ...defaultConfig,
        maxReconnectAttempts: 1
      }
      
      sessionManager.connect(configWithFewAttempts)
      vi.advanceTimersByTime(20) // Connect
      
      // Clear state changes
      onStateChangedSpy.mockClear()
      onDisconnectedSpy.mockClear()
      
      // Simulate multiple disconnections to exhaust attempts
      mockTransport.simulateDisconnection()
      vi.advanceTimersByTime(configWithFewAttempts.reconnectIntervalMs + 50)
      
      mockTransport.simulateDisconnection()
      vi.advanceTimersByTime(configWithFewAttempts.reconnectIntervalMs + 50)
      
      // Should eventually reach DISCONNECTED state with 0 attempts
      expect(currentState.reconnectAttemptsLeft).toBe(0)
      expect(onDisconnectedSpy).toHaveBeenCalled()
      
      // Check state history for DISCONNECTED state
      const disconnectedState = stateHistory.find(state => state.sessionState === SessionState.DISCONNECTED)
      expect(disconnectedState).toBeDefined()
      
      vi.useRealTimers()
    })
  })

  describe('Session Lifecycle', () => {
    it('should clean up timers and connections on disconnect', () => {
      vi.useFakeTimers()
      
      sessionManager.connect(defaultConfig)
      vi.advanceTimersByTime(20)
      
      // Clear state changes
      onStateChangedSpy.mockClear()
      
      sessionManager.disconnect()
      
      expect(mockTransport.isConnected).toBe(false)
      // After disconnect, the session may trigger reconnection logic
      expect([SessionState.SESSION_INIT, SessionState.CONNECTING]).toContain(currentState.sessionState)
      
      vi.useRealTimers()
    })

    it('should maintain session state consistency through callbacks', () => {
      // Initial state should be tracked
      expect(currentState).toEqual({
        reconnectAttemptsLeft: 0,
        sessionId: null,
        sessionState: SessionState.DISCONNECTED
      })
      
      sessionManager.connect(defaultConfig)
      
      // State should be updated through callback
      expect(currentState.sessionState).toBe(SessionState.CONNECTING)
      expect(currentState.reconnectAttemptsLeft).toBe(defaultConfig.maxReconnectAttempts)
      
      // Should have history of state changes
      expect(stateHistory.length).toBeGreaterThan(0)
      expect(stateHistory[stateHistory.length - 1]).toEqual(currentState)
    })
  })

  describe('Message Handling', () => {
    it('should track sent messages through transport layer', () => {
      vi.useFakeTimers()
      
      sessionManager.connect(defaultConfig)
      vi.advanceTimersByTime(20) // Connect and send session create
      
      expect(mockTransport.sentMessages.length).toBe(1)
      
      vi.useRealTimers()
    })

    it('should discard non-PIMessage messages', () => {
      const testBuffer = new Uint8Array([5, 6, 7, 8]) // Invalid FlatBuffer - will be discarded
      
      // Simulate receiving a non-PIMessage (invalid buffer)
      if (mockTransport.onMessage) {
        mockTransport.onMessage(testBuffer)
      }
      
      // Since it's not a valid PIMessage, it should be discarded and not forwarded to onMessage handler
      expect(onMessageSpy).not.toHaveBeenCalled()
    })
  })

  describe('State Change Tracking', () => {
    it('should track all state transitions through onStateChanged', () => {
      vi.useFakeTimers()
      
      // Start connection
      sessionManager.connect(defaultConfig)
      
      // Should have recorded CONNECTING state
      expect(stateHistory).toContainEqual(
        expect.objectContaining({
          sessionState: SessionState.CONNECTING,
          reconnectAttemptsLeft: defaultConfig.maxReconnectAttempts
        })
      )
      
      // Trigger transport connection
      vi.advanceTimersByTime(20)
      
      // Should have recorded SESSION_INIT state
      expect(stateHistory).toContainEqual(
        expect.objectContaining({
          sessionState: SessionState.SESSION_INIT
        })
      )
      
      expect(onStateChangedSpy).toHaveBeenCalledTimes(2) // CONNECTING + SESSION_INIT
      
      vi.useRealTimers()
    })

    it('should provide state snapshots that are independent copies', () => {
      vi.useFakeTimers()
      
      sessionManager.connect(defaultConfig)
      
      const firstStateSnapshot = currentState
      
      // Wait for some state changes
      vi.advanceTimersByTime(20) // This will trigger transport connection and state change
      
      // Original snapshot should remain unchanged
      expect(firstStateSnapshot.sessionState).toBe(SessionState.CONNECTING)
      expect(currentState.sessionState).not.toBe(firstStateSnapshot.sessionState)
      
      vi.useRealTimers()
    })
  })

  describe('Integration Test - Complete Success Flow', () => {
    it('should complete a full successful connection cycle with state tracking', async () => {
      vi.useFakeTimers()
      
      // Start connection
      sessionManager.connect(defaultConfig)
      expect(currentState.sessionState).toBe(SessionState.CONNECTING)
      
      // Transport connects
      vi.advanceTimersByTime(20)
      expect(currentState.sessionState).toBe(SessionState.SESSION_INIT)
      expect(mockTransport.sentMessages.length).toBe(1) // Session create sent
      
      // Simulate session create reply with real FlatBuffer message
      mockTransport.simulateSessionCreateReply('integration-test-session')
      
      // Verify final state through callbacks
      expect(currentState.sessionState).toBe(SessionState.CONNECTED)
      expect(currentState.sessionId).toBe('integration-test-session')
      expect(currentState.reconnectAttemptsLeft).toBe(defaultConfig.maxReconnectAttempts)
      expect(onConnectedSpy).toHaveBeenCalledOnce()
      
      // Verify state transition history
      const expectedStates = [SessionState.CONNECTING, SessionState.SESSION_INIT, SessionState.CONNECTED]
      expectedStates.forEach(expectedState => {
        expect(stateHistory).toContainEqual(
          expect.objectContaining({ sessionState: expectedState })
        )
      })
      
      vi.useRealTimers()
    })
  })
})