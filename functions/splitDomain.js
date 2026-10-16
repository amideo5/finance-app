function assertPaise(value, label, allowZero = false) {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    const qualifier = allowZero ? 'a non-negative' : 'a positive';
    throw new Error(`${label} must be ${qualifier} whole-paise amount.`);
  }
  return value;
}

function participantSum(participants) {
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 100) {
    throw new Error('Choose between 1 and 100 allocation participants.');
  }
  const seen = new Set();
  let sum = 0;
  for (const participant of participants) {
    if (!participant || typeof participant.userId !== 'string' || participant.userId.trim() === '') {
      throw new Error('Participant UID is required.');
    }
    if (seen.has(participant.userId)) throw new Error('Participants must be unique.');
    seen.add(participant.userId);
    sum += assertPaise(participant.shareAmountInPaise, 'Participant share', true);
    if (!Number.isSafeInteger(sum)) throw new Error('Participant shares exceed supported precision.');
  }
  return sum;
}

function validateEqualShares(totalAmountInPaise, participants) {
  participantSum(participants);
  if (!Number.isSafeInteger(totalAmountInPaise) || totalAmountInPaise <= 0) throw new Error('Split total must be positive whole paise.');
  const base = Math.floor(totalAmountInPaise / participants.length);
  const remainder = totalAmountInPaise % participants.length;
  for (let index = 0; index < participants.length; index++) {
    const expected = base + (index < remainder ? 1 : 0);
    if (participants[index].shareAmountInPaise !== expected) throw new Error('Equal split shares must use deterministic remainder allocation.');
  }
  return true;
}

function makeObligations(participants, creatorUid) {
  return participants
    .filter((participant) => participant.userId !== creatorUid && participant.shareAmountInPaise > 0)
    .map((participant) => ({
      fromUserId: participant.userId,
      toUserId: creatorUid,
      amountInPaise: participant.shareAmountInPaise,
      acceptedAmountInPaise: 0,
      pendingAmountInPaise: 0,
    }));
}

function allObligationsPaid(obligations) {
  return obligations.every((item) => item.acceptedAmountInPaise === item.amountInPaise && item.pendingAmountInPaise === 0);
}

function splitStatus(obligations) {
  if (allObligationsPaid(obligations)) return 'finalizing';
  return obligations.some((item) => item.acceptedAmountInPaise > 0) ? 'partially_settled' : 'pending_settlement';
}

function obligationIndex(obligations, fromUserId, toUserId) {
  return obligations.findIndex((obligation) => obligation.fromUserId === fromUserId && obligation.toUserId === toUserId);
}

module.exports = { assertPaise, participantSum, validateEqualShares, makeObligations, allObligationsPaid, splitStatus, obligationIndex };
