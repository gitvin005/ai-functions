import { Client, Databases, Query, ID } from 'node-appwrite'

// ✅ allowed content types — matches your dropdown exactly
const ALLOWED_TYPES = [
  'blog post',
  'ad copy',
  'social media post',
  'email',
  'product description'
]

// ✅ rate limit config
const RATE_LIMIT = {
  free: { requestsPerMinute: 3, creditsPerDay: 10 },
  pro:  { requestsPerMinute: 10, creditsPerDay: 100 }
}

export default async ({ req, res }) => {

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }

  if (req.method === 'OPTIONS') {
    return res.send('', 204, headers)
  }

  // ✅ only allow POST
  if (req.method !== 'POST') {
    return res.json({ error: 'Method not allowed' }, 405, headers)
  }

  // ── Parse body ─────────────────────────────────────────────
  let body = {}
  try {
    body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body || {}
  } catch {
    return res.json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const { userId, prompt, contentType } = body

  // ── Validate required fields ────────────────────────────────
  if (!userId || !prompt || !contentType) {
    return res.json({
      error: 'Missing required fields: userId, prompt, contentType'
    }, 400, headers)
  }

  // ── Validate prompt length ──────────────────────────────────
  if (prompt.length > 2000) {
    return res.json({ error: 'Prompt too long. Max 2000 characters.' }, 400, headers)
  }

  // ✅ Validate content type — block anything not in the list
  const normalizedType = contentType.toLowerCase().trim()
  if (!ALLOWED_TYPES.includes(normalizedType)) {
    return res.json({
      error: `Invalid content type. Allowed types: ${ALLOWED_TYPES.join(', ')}`
    }, 400, headers)
  }

  try {
    // ── Connect to Appwrite ─────────────────────────────────
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY)

    const db = new Databases(client)

    // ── Get user meta ───────────────────────────────────────
    const metaRes = await db.listDocuments(
      process.env.DB_ID,
      process.env.USER_META_COLLECTION,
      [Query.equal('userId', userId)]
    )

    if (!metaRes.documents.length) {
      return res.json({ error: 'User not found' }, 404, headers)
    }

    let meta = metaRes.documents[0]
    const plan = meta.plan || 'free'
    const limits = RATE_LIMIT[plan] || RATE_LIMIT.free

    // ── Reset daily credits if new day ──────────────────────
    const today = new Date().toDateString()
    const lastReset = new Date(meta.lastReset).toDateString()

    if (today !== lastReset) {
      meta = await db.updateDocument(
        process.env.DB_ID,
        process.env.USER_META_COLLECTION,
        meta.$id,
        {
          credits: limits.creditsPerDay,
          lastReset: new Date().toISOString()
        }
      )
    }

    // ✅ Check daily credits
    if (meta.credits <= 0) {
      return res.json({
        error: `Daily limit reached. ${plan === 'free' ? 'Upgrade to Pro for 100 credits/day.' : 'Credits reset tomorrow.'}`,
        upgradeRequired: plan === 'free'
      }, 403, headers)
    }

    // ✅ Rate limiting — check requests in last 60 seconds
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()

    const recentRes = await db.listDocuments(
      process.env.DB_ID,
      process.env.HISTORY_COLLECTION,
      [
        Query.equal('userId', userId),
        Query.greaterThan('createdAt', oneMinuteAgo)
      ]
    )

    if (recentRes.total >= limits.requestsPerMinute) {
      return res.json({
        error: `Rate limit hit. Max ${limits.requestsPerMinute} requests/minute on ${plan} plan. Please wait.`,
        retryAfter: 60
      }, 429, headers)
    }

    // ✅ Call OpenRouter AI
    const aiRes = await globalThis.fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://visaya-ai.netlify.app',
          'X-Title': 'Visaya AI'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          max_tokens: 1000,
          messages: [
            {
              role: 'system',
              content: `You are a professional content writer. Only generate ${contentType} content. Keep responses focused, high quality and structured.`
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      }
    )

    if (!aiRes.ok) {
      const errData = await aiRes.json()
      throw new Error(errData?.error?.message || 'AI service error')
    }

    const aiData = await aiRes.json()
    const output = aiData?.choices?.[0]?.message?.content || 'No response generated'

    // ✅ Deduct credit + save history in parallel — faster
    const updatedCredits = Math.max(meta.credits - 1, 0)
    const title = prompt.slice(0, 60) + (prompt.length > 60 ? '...' : '')
    const createdAt = new Date().toISOString()

    await Promise.all([
      // deduct credit
      db.updateDocument(
        process.env.DB_ID,
        process.env.USER_META_COLLECTION,
        meta.$id,
        { credits: updatedCredits }
      ),
      // save to history
      db.createDocument(
        process.env.DB_ID,
        process.env.HISTORY_COLLECTION,
        ID.unique(),
        {
          userId,
          prompt,
          output,
          title,
          type: contentType,
          createdAt
        }
      )
    ])

    return res.json({
      output,
      creditsLeft: updatedCredits,
      plan
    }, 200, headers)

  } catch (err) {
    console.error('Function error:', err.message)
    return res.json({ error: err.message || 'Server error' }, 500, headers)
  }
}