const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const projectId = 'demo-finance-splits';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
let app;
let db;

async function emulatorUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${Date.now()}@example.test`, password: 'password123', returnSecureToken: true }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return { uid: result.localId, token: result.idToken };
}

async function callFunction(name, token, data) {
  const response = await fetch(`http://${functionsHost}/${projectId}/us-central1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error?.message || JSON.stringify(result));
  return result.result;
}

async function seedProfile(profileId, uid) {
  await db.doc(`profiles/${profileId}`).set({ userId: uid, isDefault: true, name: profileId });
}

async function seedExpense(profileId, transactionId, amount) {
  await db.doc(`profiles/${profileId}/transactions/${transactionId}`).set({
    profileId, type: 'expense', amount, currency: 'INR', date: '2026-10-16',
    category: 'Dinner', categoryId: 'food', paymentMode: 'cash', accountId: null,
  });
}

if (!enabled) {
  test('Callable settlement integration (run with Auth/Firestore/Functions emulators)', { skip: true }, () => {});
} else {
  test('creator-excluded split repayment is idempotent, atomic, and finalizes only participant allocations', async () => {
    process.env.GCLOUD_PROJECT = projectId;
    app = admin.initializeApp({ projectId }, `split-test-${Date.now()}`);
    db = app.firestore();
    const [payer, debtorB, debtorC] = await Promise.all([
      emulatorUser('payer'), emulatorUser('debtor-b'), emulatorUser('debtor-c'),
    ]);
    const payerProfile = `profile-${payer.uid}`;
    const profileB = `profile-${debtorB.uid}`;
    const profileC = `profile-${debtorC.uid}`;
    await Promise.all([seedProfile(payerProfile, payer.uid), seedProfile(profileB, debtorB.uid), seedProfile(profileC, debtorC.uid)]);
    await Promise.all([
      db.doc(`friends/${payer.uid}_${debtorB.uid}`).set({ userId: payer.uid, friendId: debtorB.uid }),
      db.doc(`friends/${payer.uid}_${debtorC.uid}`).set({ userId: payer.uid, friendId: debtorC.uid }),
      seedExpense(payerProfile, 'dinner', 30),
    ]);

    const created = await callFunction('createSharedExpense', payer.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'dinner', title: 'Dinner', type: 'custom',
      participants: [
        { userId: debtorB.uid, displayName: 'B', shareAmountInPaise: 1500 },
        { userId: debtorC.uid, displayName: 'C', shareAmountInPaise: 1500 },
      ],
    });
    const splitId = created.splitId;
    const splitRef = db.doc(`splits/${splitId}`);
    assert.equal((await splitRef.get()).get('paidByUserId'), payer.uid);
    assert.deepEqual((await splitRef.get()).get('participantIds'), [debtorB.uid, debtorC.uid]);
    await assert.rejects(callFunction('createSharedExpense', payer.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'dinner', title: 'Duplicate', type: 'custom',
      participants: [
        { userId: debtorB.uid, shareAmountInPaise: 1500 },
        { userId: debtorC.uid, shareAmountInPaise: 1500 },
      ],
    }));
    await assert.rejects(callFunction('createSharedExpense', debtorB.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'dinner', title: 'Wrong owner', type: 'custom',
      participants: [{ userId: debtorB.uid, shareAmountInPaise: 3000 }],
    }));
    await db.doc(`profiles/${payerProfile}/transactions/income-source`).set({
      type: 'income', amount: 1, currency: 'INR', date: '2026-10-16', category: 'Salary',
    });
    await assert.rejects(callFunction('createSharedExpense', payer.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'income-source', title: 'Invalid income', type: 'custom',
      participants: [{ userId: debtorB.uid, shareAmountInPaise: 100 }],
    }));
    await seedExpense(payerProfile, 'mismatched-source', 1);
    await assert.rejects(callFunction('createSharedExpense', payer.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'mismatched-source', title: 'Invalid total', type: 'custom',
      participants: [{ userId: debtorB.uid, shareAmountInPaise: 99 }],
    }));

    await seedExpense(payerProfile, 'included-dinner', 3);
    const includedSplitResult = await callFunction('createSharedExpense', payer.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'included-dinner', title: 'Included dinner', type: 'equal',
      participants: [
        { userId: payer.uid, displayName: 'Payer', shareAmountInPaise: 100 },
        { userId: debtorB.uid, displayName: 'B', shareAmountInPaise: 100 },
        { userId: debtorC.uid, displayName: 'C', shareAmountInPaise: 100 },
      ],
    });
    const includedSplit = await db.doc(`splits/${includedSplitResult.splitId}`).get();
    assert.equal(includedSplit.get('paidByUserId'), payer.uid);
    assert.equal(includedSplit.get('obligations').length, 2);
    assert.equal(includedSplit.get('finalizationStatus'), 'not_started');
    assert.equal(includedSplit.get('allocationTransactionIds'), undefined);

    const firstKey = `first-${Date.now()}`;
    const firstRequest = await callFunction('requestSplitRepayment', debtorB.token, {
      splitId, amountInPaise: 400, senderProfileId: profileB, idempotencyKey: firstKey,
    });
    const retry = await callFunction('requestSplitRepayment', debtorB.token, {
      splitId, amountInPaise: 400, senderProfileId: profileB, idempotencyKey: firstKey,
    });
    assert.equal(retry.settlementId, firstRequest.settlementId);
    assert.equal((await db.collection(`profiles/${profileB}/transactions`).get()).size, 0);

    await callFunction('acceptSplitRepayment', payer.token, {
      splitId, settlementId: firstRequest.settlementId, recipientProfileId: payerProfile,
    });
    let settlement = await splitRef.collection('settlements').doc(firstRequest.settlementId).get();
    assert.equal(settlement.get('status'), 'accepted');
    assert.ok(settlement.get('senderTransactionId'));
    assert.ok(settlement.get('recipientTransactionId'));
    assert.equal((await db.doc(`profiles/${profileB}/transactions/${settlement.get('senderTransactionId')}`).get()).get('kind'), 'repayment');
    assert.equal((await db.doc(`profiles/${payerProfile}/transactions/${settlement.get('recipientTransactionId')}`).get()).get('category'), 'Split Income');
    await callFunction('acceptSplitRepayment', payer.token, {
      splitId, settlementId: firstRequest.settlementId, recipientProfileId: payerProfile,
    });

    const concurrent = await Promise.allSettled([
      callFunction('requestSplitRepayment', debtorB.token, { splitId, amountInPaise: 700, senderProfileId: profileB, idempotencyKey: `race-a-${Date.now()}` }),
      callFunction('requestSplitRepayment', debtorB.token, { splitId, amountInPaise: 700, senderProfileId: profileB, idempotencyKey: `race-b-${Date.now()}` }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    const reserved = concurrent.find((result) => result.status === 'fulfilled').value;
    await callFunction('acceptSplitRepayment', payer.token, { splitId, settlementId: reserved.settlementId, recipientProfileId: payerProfile });

    const finalB = await callFunction('requestSplitRepayment', debtorB.token, {
      splitId, amountInPaise: 400, senderProfileId: profileB, idempotencyKey: `final-b-${Date.now()}`,
    });
    await callFunction('acceptSplitRepayment', payer.token, { splitId, settlementId: finalB.settlementId, recipientProfileId: payerProfile });
    const finalC = await callFunction('requestSplitRepayment', debtorC.token, {
      splitId, amountInPaise: 1500, senderProfileId: profileC, idempotencyKey: `final-c-${Date.now()}`,
    });
    await callFunction('acceptSplitRepayment', payer.token, { splitId, settlementId: finalC.settlementId, recipientProfileId: payerProfile });

    const finalSplit = await splitRef.get();
    assert.equal(finalSplit.get('status'), 'settled');
    assert.equal(finalSplit.get('finalizationStatus'), 'complete');
    assert.equal(finalSplit.get('allocationTransactionIds')[payer.uid], undefined);
    assert.equal((await db.doc(`profiles/${profileB}/transactions/${finalSplit.get(`allocationTransactionIds.${debtorB.uid}`)}`).get()).get('amountInPaise'), 1500);
    assert.equal((await db.doc(`profiles/${profileC}/transactions/${finalSplit.get(`allocationTransactionIds.${debtorC.uid}`)}`).get()).get('amountInPaise'), 1500);
    assert.equal((await db.doc(`profiles/${payerProfile}/transactions/dinner`).get()).get('amount'), 30);

    const [payerRows, bRows, cRows] = await Promise.all([
      db.collection(`profiles/${payerProfile}/transactions`).where('kind', '==', 'repayment').get(),
      db.collection(`profiles/${profileB}/transactions`).where('kind', '==', 'repayment').get(),
      db.collection(`profiles/${profileC}/transactions`).where('kind', '==', 'repayment').get(),
    ]);
    assert.equal(payerRows.size + bRows.size + cRows.size, 8);

    await seedExpense(payerProfile, 'rejected-source', 1);
    const rejectedSplit = await callFunction('createSharedExpense', payer.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'rejected-source', title: 'Rejected payment', type: 'custom',
      participants: [{ userId: debtorB.uid, shareAmountInPaise: 100 }],
    });
    const rejectedAck = await callFunction('requestSplitRepayment', debtorB.token, {
      splitId: rejectedSplit.splitId, amountInPaise: 100, senderProfileId: profileB, idempotencyKey: `reject-${Date.now()}`,
    });
    await callFunction('rejectSplitRepayment', payer.token, { splitId: rejectedSplit.splitId, settlementId: rejectedAck.settlementId });
    const rejectedSettlement = await db.doc(`splits/${rejectedSplit.splitId}/settlements/${rejectedAck.settlementId}`).get();
    assert.equal(rejectedSettlement.get('status'), 'rejected');
    assert.equal((await db.collection(`profiles/${profileB}/transactions`).where('splitId', '==', rejectedSplit.splitId).get()).size, 0);
    await callFunction('cancelSharedExpense', payer.token, { splitId: rejectedSplit.splitId });

    await seedExpense(payerProfile, 'cancelled-source', 1);
    const cancelledSplit = await callFunction('createSharedExpense', payer.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'cancelled-source', title: 'Cancelled payment', type: 'custom',
      participants: [{ userId: debtorB.uid, shareAmountInPaise: 100 }],
    });
    const cancelledAck = await callFunction('requestSplitRepayment', debtorB.token, {
      splitId: cancelledSplit.splitId, amountInPaise: 100, senderProfileId: profileB, idempotencyKey: `cancel-${Date.now()}`,
    });
    await callFunction('cancelSplitRepayment', debtorB.token, { splitId: cancelledSplit.splitId, settlementId: cancelledAck.settlementId });
    assert.equal((await db.doc(`splits/${cancelledSplit.splitId}/settlements/${cancelledAck.settlementId}`).get()).get('status'), 'cancelled');
    assert.equal((await db.collection(`profiles/${profileB}/transactions`).where('splitId', '==', cancelledSplit.splitId).get()).size, 0);
    await callFunction('cancelSharedExpense', payer.token, { splitId: cancelledSplit.splitId });
    const recreated = await callFunction('createSharedExpense', payer.token, {
      sourceProfileId: payerProfile, sourceTransactionId: 'cancelled-source', title: 'Recreated split', type: 'custom',
      participants: [{ userId: debtorB.uid, shareAmountInPaise: 100 }],
    });
    assert.ok(recreated.splitId);
  });

  test.after(async () => {
    if (app) await app.delete();
  });
}
