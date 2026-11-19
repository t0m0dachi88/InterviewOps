/**
 * In-memory presence service tracking active interview room participants.
 * Handles duplicate connections, reconnects, and multiple tabs from the same user.
 */
class PresenceService {
  constructor() {
    // interviewId -> Map<participantId, { id, name, role, isCandidate, socketIds: Set<string>, joinedAt, lastSeenAt }>
    this.rooms = new Map();
    // socketId -> { interviewId, participantId }
    this.socketIndex = new Map();
  }

  /**
   * Add a socket connection for a participant in an interview room.
   *
   * @param {string} interviewId
   * @param {string} socketId
   * @param {{ id: string, name: string, role: string, isCandidate: boolean }} participant
   * @returns {{ isNewParticipant: boolean, participant: object, participants: Array<object> }}
   */
  addParticipant(interviewId, socketId, participant) {
    const interviewIdStr = String(interviewId);
    const participantId = String(participant.id);

    if (!this.rooms.has(interviewIdStr)) {
      this.rooms.set(interviewIdStr, new Map());
    }

    const roomMap = this.rooms.get(interviewIdStr);
    let isNewParticipant = false;
    let entry = roomMap.get(participantId);

    if (!entry) {
      isNewParticipant = true;
      entry = {
        id: participantId,
        name: participant.name,
        role: participant.role,
        isCandidate: Boolean(participant.isCandidate),
        socketIds: new Set([socketId]),
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      };
      roomMap.set(participantId, entry);
    } else {
      entry.socketIds.add(socketId);
      entry.lastSeenAt = new Date();
    }

    this.socketIndex.set(socketId, { interviewId: interviewIdStr, participantId });

    return {
      isNewParticipant,
      participant: this._serializeParticipant(entry),
      participants: this.getParticipants(interviewIdStr),
    };
  }

  /**
   * Remove a socket connection.
   * If participant has no remaining sockets in room, removes participant from presence.
   *
   * @param {string} socketId
   * @returns {{ interviewId: string, participantId: string, isRemoved: boolean, participant: object | null, participants: Array<object> } | null}
   */
  removeSocket(socketId) {
    const meta = this.socketIndex.get(socketId);
    if (!meta) return null;

    const { interviewId, participantId } = meta;
    this.socketIndex.delete(socketId);

    const roomMap = this.rooms.get(interviewId);
    if (!roomMap) return null;

    const entry = roomMap.get(participantId);
    if (!entry) return null;

    entry.socketIds.delete(socketId);

    let isRemoved = false;
    let removedParticipant = null;

    if (entry.socketIds.size === 0) {
      isRemoved = true;
      removedParticipant = this._serializeParticipant(entry);
      roomMap.delete(participantId);

      if (roomMap.size === 0) {
        this.rooms.delete(interviewId);
      }
    }

    return {
      interviewId,
      participantId,
      isRemoved,
      participant: removedParticipant,
      participants: this.getParticipants(interviewId),
    };
  }

  /**
   * Explicitly remove a participant by ID (e.g. when leave endpoint is called).
   *
   * @param {string} interviewId
   * @param {string} participantId
   * @returns {boolean}
   */
  removeParticipant(interviewId, participantId) {
    const interviewIdStr = String(interviewId);
    const participantIdStr = String(participantId);

    const roomMap = this.rooms.get(interviewIdStr);
    if (!roomMap) return false;

    const entry = roomMap.get(participantIdStr);
    if (!entry) return false;

    for (const socketId of entry.socketIds) {
      this.socketIndex.delete(socketId);
    }
    roomMap.delete(participantIdStr);

    if (roomMap.size === 0) {
      this.rooms.delete(interviewIdStr);
    }
    return true;
  }

  /**
   * List all current participants in an interview room.
   *
   * @param {string} interviewId
   * @returns {Array<{ id: string, name: string, role: string, isCandidate: boolean, joinedAt: string, connectionCount: number }>}
   */
  getParticipants(interviewId) {
    const interviewIdStr = String(interviewId);
    const roomMap = this.rooms.get(interviewIdStr);
    if (!roomMap) return [];

    return Array.from(roomMap.values()).map((p) => this._serializeParticipant(p));
  }

  _serializeParticipant(entry) {
    return {
      id: entry.id,
      name: entry.name,
      role: entry.role,
      isCandidate: entry.isCandidate,
      joinedAt: entry.joinedAt.toISOString(),
      connectionCount: entry.socketIds.size,
    };
  }

  clear() {
    this.rooms.clear();
    this.socketIndex.clear();
  }
}

export const presenceService = new PresenceService();
