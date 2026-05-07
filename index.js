  import fetch from 'node-fetch'
  import { Client, Databases, Query } from 'node-appwrite'

  export default async ({ req, res }) => {

    // ✅ CORS headers
    const headers = {
      'Access-Control-Allow-Origin': '*', // change in prod
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }

    // ✅ Handle preflight
    if (req.method === 'OPTIONS') {
      return res.send('', 204, headers)
    }

    try {
      const client = new Client()
        .setEndpoint(process.env.APPWRITE_ENDPOINT)
        .setProject(process.env.APPWRITE_PROJECT_ID)
        .setKey(process.env.APPWRITE_API_KEY)

      const db = new Databases(client)

      // ✅ Safe body parse
      const body = JSON.parse(req.body || '{}')
      const { userId, prompt } = body

      if (!userId || !prompt) {
        return res.json({ error: 'Missing userId or prompt' }, 400, headers)
      }

      // ✅ Get user meta
      const metaRes = await db.listDocuments(
        process.env.DB_ID,
        process.env.USER_META_COLLECTION,
        [Query.equal('userId', userId)]
      )

      let meta = metaRes.documents[0]

      // ❗ Prevent crash if not found
      if (!meta) {
        return res.json({ error: 'User meta not found' }, 404, headers)
      }

      // ✅ Reset daily credits
      const today = new Date().toDateString()
      const last = new Date(meta.lastReset).toDateString()

      if (today !== last) {
        const newCredits = meta.plan === 'pro' ? 100 : 10

        meta = await db.updateDocument(
          process.env.DB_ID,
          process.env.USER_META_COLLECTION,
          meta.$id,
          {
            credits: newCredits,
            lastReset: new Date().toISOString()
          }
        )
      }

      // ✅ Check credits
      if (meta.credits <= 0) {
        return res.json({ error: 'Daily limit reached' }, 403, headers)
      }

      // ✅ Call OpenRouter
      const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }]
        })
      })

      const data = await aiRes.json()

      const output =
        data?.choices?.[0]?.message?.content || 'No response generated'

      // ❗ Prevent negative credits
      const updatedCredits = Math.max(meta.credits - 1, 0)

      await db.updateDocument(
        process.env.DB_ID,
        process.env.USER_META_COLLECTION,
        meta.$id,
        {
          credits: updatedCredits
        }
      )

      // ✅ Final response with headers
      return res.json(
        {
          output,
          creditsLeft: updatedCredits
        },
        200,
        headers
      )

    } catch (err) {
      return res.json(
        {
          error: err.message || 'Server error'
        },
        500,
        {
          'Access-Control-Allow-Origin': '*'
        }
      )
    }
  }