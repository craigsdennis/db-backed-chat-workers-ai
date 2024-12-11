import { events } from 'fetch-event-stream';
import { Context, Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { jwt, sign } from 'hono/jwt';
import type { JwtVariables } from 'hono/jwt';
import { streamText } from 'hono/streaming';
import { hashPassword, verifyPassword } from './hashword';
import { HTTPException } from 'hono/http-exception';
import { HTTPExceptionFunction } from 'hono/timeout';

// TODO: You should change this!
const SYSTEM_MESSAGE = `You are a friendly assistant who absolutely loves the Cloudflare Developer stack.

You will answer any question the user asks, but will try to make sure to drop little wisdom nuggets about the Cloudflare Developer platform.

When you do share Cloudflare wisdom, make sure to drop an 🧡 emoji.

Keep things relatively short when conversing.
`;

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const DEFAULT_CONVERSATION_TITLE = 'Untitled';

type CustomVars = {
	userId: string;
};

type CustomContext = {
	Bindings: Env;
	Variables: JwtVariables & CustomVars;
};

const app = new Hono<CustomContext>();

async function authenticateSession(c: Context<CustomContext>, userId: string) {
	const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
	const expiresDate = new Date();
	expiresDate.setTime(expiresDate.getTime() + expires);
	const payload = {
		sub: userId,
		role: 'user',
		exp: expires,
	};
	const jwtPayload = await sign(payload, c.env.JWT_SECRET);
	setCookie(c, 'jwtPayload', jwtPayload);
	return true;
}

app.post('/user/signup', async (c) => {
	const body = await c.req.parseBody();
	const userId = crypto.randomUUID();
	const hashword = await hashPassword(body.password as string);
	// Insert user
	const response = await c.env.DB.prepare(`INSERT INTO users (id, username, password) VALUES (?, ?, ?)`)
		.bind(userId, body.username, hashword)
		.all();
	await authenticateSession(c, userId);
	return c.redirect('/');
});

app.post('/user/login', async (c) => {
	const body = await c.req.parseBody();
	const { results } = await c.env.DB.prepare(`SELECT * FROM users WHERE username=? LIMIT 1`).bind(body.username).all();
	if (results.length !== 1) {
		const errorResponse = new Response('Unauthorized', {
			status: 401,
			headers: {
				Authenticate: 'error="invalid_user_or_password"',
			},
		});
		throw new HTTPException(401, { res: errorResponse });

	}
	const verified = await verifyPassword(body.password as string, results[0].password as string);
	if (!verified) {
		const errorResponse = new Response('Unauthorized', {
			status: 401,
			headers: {
				Authenticate: 'error="invalid_password"',
			},
		});
		throw new HTTPException(401, { res: errorResponse });
	}
	const userId = results[0].id as string;
	await authenticateSession(c, userId);
	return c.redirect('/');
});

app.get('/logout', async (c) => {
	deleteCookie(c, 'jwtPayload');
	return c.redirect('/');
});

// Protect all API routes
app.use('/api/*', async (c, next) => {
	const jwtMiddleware = jwt({
		secret: c.env.JWT_SECRET,
		cookie: 'jwtPayload',
	});
	return jwtMiddleware(c, next);
});

app.use('*', async (c, next) => {
	const jwtPayload = c.get('jwtPayload');
	c.set('userId', jwtPayload.sub);
	await next();
});

app.onError(async (err, c) => {
	console.error(err);
	if (err instanceof HTTPException) {
		const res = err.getResponse();
		if (res.status === 401) {
			return c.redirect(`/login?msg=Try+again+please`);
		}
	}
	return new Response(err.message);
});

app.get('/api/conversations', async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT * FROM conversations where user_id=? ORDER BY created_at DESC`)
		.bind(c.get('userId'))
		.all();
	return c.json({ results });
});

app.post('/api/conversations', async (c) => {
	const conversationId = crypto.randomUUID();
	const { results } = await c.env.DB.prepare(`INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?) RETURNING *;`)
		.bind(conversationId, c.get('userId'), DEFAULT_CONVERSATION_TITLE)
		.all();
	return c.json(results[0]);
});

async function getMessagesForConversation(c: Context<CustomContext>, conversationId: string) {
	console.log('Getting messages for', conversationId);
	const { results } = await c.env.DB.prepare(`SELECT * from messages WHERE conversation_id=? ORDER BY created_at`)
		.bind(conversationId)
		.all();
	return results;
}

app
	.get('/api/conversations/:conversationId/messages', async (c) => {
		const conversationId = c.req.param('conversationId');
		const results = await getMessagesForConversation(c, conversationId);
		return c.json({ results });
	})
	.post(async (c) => {
		const payload = await c.req.json();
		const conversationId = c.req.param('conversationId');
		const messageRecords = await getMessagesForConversation(c, conversationId);
		const messages = messageRecords.map((mr) => {
			return { role: mr.role, content: mr.content };
		});
		// Always prepend the system message
		messages.unshift({ role: 'system', content: SYSTEM_MESSAGE });
		messages.push({ role: 'user', content: payload.content });
		// @ts-ignore
		const responseStream = await c.env.AI.run(MODEL, {
			messages,
			stream: true,
		});

		return streamText(c, async (stream) => {
			// Parse the Server Sent Events on the server side
			const sse = events(new Response(responseStream));
			// Capture the message on this side
			let messageContent = '';
			for await (const event of sse) {
				if (event.data !== undefined && event.data !== '[DONE]') {
					const data = JSON.parse(event.data);
					const token = data.response as string;
					messageContent += token;
					stream.write(token);
				}
			}
			// Add to the messages table
			await c.env.DB.prepare(`INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`)
				.bind(crypto.randomUUID(), conversationId, 'user', payload.content)
				.run();
			await c.env.DB.prepare(`INSERT INTO messages (id, conversation_id, role, content)  VALUES (?, ?, ?, ?)`)
				.bind(crypto.randomUUID(), conversationId, 'assistant', messageContent)
				.run();
		});
	});

async function summarizeConversation(env: Env, conversationId: string) {
	const response = await env.DB.prepare(`SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at;`).bind(conversationId).all();
	const results = response.results as { role: string; content: string }[];
	// Create a string representation of the conversation
	const convo = results.map((r) => `${r.role}: ${r.content}`).join('\n\n');
	const summaryResponse = await env.AI.run(MODEL, {
		prompt: `Summarize the following conversation and make sure to focus heavily on what the user is asking about. Only include pertinent information.

		<conversation>
		${convo}
		</conversation>

		Return only the summary, no prefix or explanation
		`,
	});
	// @ts-ignore - This is correct
	const summary = summaryResponse.response;
	console.log('summary', summary);
	const titleResponse = await env.AI.run(MODEL, {
		prompt: `Create a short title for this conversation that is less than 255 characters and should be named after what the user is trying to accomplish by interacting with the assistant in the conversation.

		<conversation>
		${convo}
		</conversation>

		Return only the title, no prefix or explanation. Do not surround it in quotes.
		`,
	});
	// @ts-ignore - This is correct
	const title = titleResponse.response;
	console.log('title', title);
	const updateResponse = await env.DB.prepare(`UPDATE conversations SET title=?, summary=? WHERE id=?`)
		.bind(title.substring(0, 250), summary, conversationId)
		.run();
	return updateResponse.meta.changes === 1;
}

async function summarizeConversations(env: Env) {
	const response = await env.DB.prepare(
		`SELECT
			conversations.id, count(messages.id) AS "message_count"
		FROM
			conversations LEFT OUTER JOIN messages ON conversations.id = messages.conversation_id
		WHERE
			conversations.title=?
		GROUP BY 1;`
	)
		.bind(DEFAULT_CONVERSATION_TITLE)
		.all();
	const results = response.results as { id: string; message_count: number }[];
	const inactiveIds: string[] = results.filter((r) => r.message_count === 0).map((r) => r.id);
	console.log('inactiveIds', inactiveIds);
	if (inactiveIds.length > 0) {
		// TODO: Do some future time, do not do this to recently created
		console.log(`Attempting to delete ${inactiveIds.length} inactive ids`);
		const idStrings = inactiveIds.map((id) => `'${id}'`).join(', ');
		await env.DB.prepare(`DELETE FROM conversations WHERE id IN (${idStrings});`).run();
	}
	// Active with messages
	const conversationIds = results.filter((r) => r.message_count > 0).map((r) => r.id);
	// Run them all in parallel (maybe batch?)
	const states = await Promise.all(conversationIds.map((id) => summarizeConversation(env, id)));
	console.log('states', states);
	return true;
}

export default {
	fetch: app.fetch,
	scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
		ctx.passThroughOnException();
		ctx.waitUntil(summarizeConversations(env));
	},
};
