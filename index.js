import { Client, Databases, Query, ID } from 'node-appwrite'

export default async ({ req, res }) => {

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }

  if (req.method === 'OPTIONS') {
    return res.send('', 204, headers)
  }

  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY)

    const db = new Databases(client)

    // ✅ safe body parse
    let body = {}
    try {
      body = typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body || {}
    } catch {
      return res.json({ error: 'Invalid JSON body' }, 400, headers)
    }

    const { userId, prompt } = body

    if (!userId || !prompt) {
      return res.json({ error: 'Missing userId or prompt' }, 400, headers)
    }

    // get user meta
    const metaRes = await db.listDocuments(
      process.env.DB_ID,
      process.env.USER_META_COLLECTION,
      [Query.equal('userId', userId)]
    )

    if (!metaRes.documents.length) {
      return res.json({ error: 'User meta not found' }, 404, headers)
    }

    let meta = metaRes.documents[0]

    // reset daily credits
    const today = new Date().toDateString()
    const last = new Date(meta.lastReset).toDateString()

    if (today !== last) {
      meta = await db.updateDocument(
        process.env.DB_ID,
        process.env.USER_META_COLLECTION,
        meta.$id,
        {
          credits: meta.plan === 'pro' ? 100 : 10,
          lastReset: new Date().toISOString()
        }
      )
    }

    // check credits
    if (meta.credits <= 0) {
      return res.json({
        error: 'Daily limit reached. Upgrade to Pro.',
        upgradeRequired: true
      }, 403, headers)
    }

    // ✅ use globalThis.fetch — no node-fetch needed
    const aiRes = await globalThis.fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }]
        })
      }
    )

    const aiData = await aiRes.json()
    const output = aiData?.choices?.[0]?.message?.content || 'No response generated'

    const updatedCredits = Math.max(meta.credits - 1, 0)

    await db.updateDocument(
      process.env.DB_ID,
      process.env.USER_META_COLLECTION,
      meta.$id,
      { credits: updatedCredits }
    )

    return res.json({ output, creditsLeft: updatedCredits }, 200, headers)

  } catch (err) {
    return res.json({ error: err.message || 'Server error' }, 500, headers)
  }
}