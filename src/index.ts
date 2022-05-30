import express from 'express';
import petitio from 'petitio';
import { createHmac } from 'crypto';
import { load } from 'dotenv-extended';
import { RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10';
import Logger from '../lib/classes/Logger.js';

load({ path: '.env' });

const app = express();
app.use(express.json());

const localCache = {
	accessToken: '',
	accessTokenExpiresIn: 0,
	spacedriveBroadCasters: ['133183866', '53168490', '166642672', '48234453'],
	polarsCafeBroadcasters: ['160027788'],
	spacedriveWebhook: process.env.SPACEDRIVE_WEBHOOK_URL,
	polarsCafeWebhook: process.env.POLARS_CAFE_WEBHOOK_URL
};

/**
 * Get our Twitch API token as well as register all of our users.
 */
(async () => {
	const { access_token: accessToken, expires_in: expiresIn } = await petitio(
		`https://id.twitch.tv/oauth2/token?client_id=${process.env.CLIENT_ID}&client_secret=${
			process.env.CLIENT_SECRET
		}&grant_type=${'client_credentials'}`,
		'POST'
	).json();

	localCache.accessToken = accessToken;
	localCache.accessTokenExpiresIn = expiresIn;

	const broadcasterIds = localCache.polarsCafeBroadcasters.concat(
		localCache.spacedriveBroadCasters
	);

	return Promise.all(
		broadcasterIds.map((broadcasterId) =>
			registerBroadcaster(accessToken, broadcasterId).then((response) =>
				Logger.info(
					`Registered ${broadcasterId} - Status Code ${response.statusCode}`,
					response.statusCode === 202 ? '' : response.json()
				)
			)
		)
	);
})();

/**
 * Handle callbacks for our EventSub system.
 */
app.post('/callback', async (request, response) => {
	Logger.info(
		`Received a request on /callback. Notifications: ${
			request.header('twitch-eventsub-message-type') === 'notification'
		}`
	);
	if (request.header('twitch-eventsub-message-type') === 'notification') {
		if (
			!request.header('Twitch-Eventsub-Message-Id') ||
			!request.header('Twitch-Eventsub-Message-Timestamp')
		) {
			Logger.error(null, 'Notifications - 403 - Missing Headers.');
			return response.status(403).end();
		}

		const expectedSig = `sha256=${createHmac('sha256', process.env.REQUEST_SECRET)
			.update(
				request.header('Twitch-Eventsub-Message-Id')! +
					request.header('Twitch-Eventsub-Message-Timestamp')! +
					JSON.stringify(request.body)
			)
			.digest('hex')}`;
		const actualSig = request.header('Twitch-Eventsub-Message-Signature');

		if (expectedSig !== actualSig) {
			Logger.error(null, 'Notifications - 403 - Invalid Signature');
			return response.status(403).end();
		}

		const { type } = request.body.subscription;
		const broadcasterId = request.body.subscription.condition.broadcaster_user_id;
		if (type !== 'stream.online') {
			Logger.error(null, `Notifications - 400 - Not stream.online, instead ${type}`);
			return response.status(204).end();
		}

		let res = await getStreamData(localCache.accessToken, broadcasterId);
		let statusCode = res.statusCode;
		let json = res.json();

		if (statusCode != 200) {
			const { access_token: accessToken, expires_in: expiresIn } = await petitio(
				`https://id.twitch.tv/oauth2/token?client_id=${process.env.CLIENT_ID}&client_secret=${
					process.env.CLIENT_SECRET
				}&grant_type=${'client_credentials'}`,
				'POST'
			).json();

			localCache.accessToken = accessToken;
			localCache.accessTokenExpiresIn = expiresIn;

			res = await getStreamData(accessToken, broadcasterId);
			json = res.json();
			statusCode = res.statusCode;
		}

		if (statusCode !== 200) {
			Logger.error(null, 'Notifications - 500 - Invalid access code.');
			return response.status(500).end();
		} else if (!json.data.length || !json.data[0]?.broadcaster_name) {
			Logger.error(null, 'Notifications - 400 - Invalid stream data.');
			return response.status(400).end();
		}

		const { title, broadcaster_name: displayName } = json.data[0];

		sendMessageToDiscordWebhook(title, displayName, broadcasterId);

		Logger.info('Notifications - 204 - Success');

		return response.status(204).type('text/plain').end();
	}

	const expectedSig = `sha256=${createHmac('sha256', process.env.REQUEST_SECRET)
		.update(
			request.header('Twitch-Eventsub-Message-Id')! +
				request.header('Twitch-Eventsub-Message-Timestamp')! +
				JSON.stringify(request.body)
		)
		.digest('hex')}`;
	const actualSig = request.header('Twitch-Eventsub-Message-Signature');

	if (expectedSig !== actualSig) {
		Logger.error(null, `403 - Invalid Signature`);
		return response.status(403).end();
	}

	const { challenge } = request.body;

	Logger.info(`Challenge - 204 - Success`);

	return response.status(200).type('text/plain').send(challenge).end();
});

// NOTE: Before subscribing to events, you must create a callback that listens for events. Your callback must use SSL and listen on port 443.
// > https://dev.twitch.tv/docs/eventsub/handling-webhook-events
app.listen(8005);

/**
 * Send a message to a Discord webhook.
 * @param title The title of the stream.
 * @param username The username of the broadcaster.
 * @returns The response from Discord.
 */
function sendMessageToDiscordWebhook(title: string, username: string, broadcasterId: string) {
	if (
		localCache.spacedriveBroadCasters.includes(broadcasterId) &&
		!title?.toLowerCase().includes('spacedrive')
	) {
		Logger.info(`${username} does not have "spacedrive" in their title.`);
		return;
	}

	const message: RESTPostAPIWebhookWithTokenJSONBody = {
		content: `${username} is now [live on Twitch](<https://twitch.tv/${username}>)!${
			title ? ` They'll be streaming ${title}.` : ''
		}`
	};

	Logger.info(
		`Sending webhook message with content of ${message.content} into ${
			localCache.spacedriveBroadCasters.includes(broadcasterId) ? 'Spacedrive' : "Polar's Cafe"
		}`
	);

	return petitio(
		localCache.spacedriveBroadCasters.includes(broadcasterId)
			? localCache.spacedriveWebhook
			: localCache.polarsCafeWebhook,
		'POST'
	)
		.body(message)
		.send();
}

/**
 * Get data about a Twitch stream from the Twitch API.
 * @param token Our Twitch API token.
 * @param broadcasterId The broadcaster ID of the stream.
 * @returns Data about the stream returned by the Twitch API.
 */
function getStreamData(token: string, broadcasterId: string) {
	return petitio(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, 'GET')
		.header('Authorization', `Bearer ${token}`)
		.header('Client-ID', process.env.CLIENT_ID)
		.send();
}

/**
 * Register to receive events from Twitch.
 * @param token Our Twitch API token.
 * @param broadcasterId The broadcaster ID to register.
 * @returns The response from Twitch.
 */
async function registerBroadcaster(token: string, broadcasterId: string) {
	return petitio(
		`https://api.twitch.tv/helix/eventsub/subscriptions?broadcaster_id=${broadcasterId}`,
		'POST'
	)
		.header('Authorization', `Bearer ${token}`)
		.header('Client-ID', process.env.CLIENT_ID)
		.header('Content-Type', 'application/json')
		.body({
			type: 'stream.online',
			version: '1',
			condition: {
				broadcaster_user_id: broadcasterId
			},
			transport: {
				method: 'webhook',
				callback: `${process.env.BASE_URL}/callback`,
				secret: process.env.REQUEST_SECRET
			}
		})
		.send();
}
