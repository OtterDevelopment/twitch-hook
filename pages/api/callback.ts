import { createHmac } from 'crypto';
import { RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10';
import { NextApiRequest, NextApiResponse } from 'next';
import Logger from '../../lib/classes/Logger';
import mongo from '../../utils/mongo';

export default async (req: NextApiRequest, res: NextApiResponse) => {
	Logger.info(
		`Received a request on /callback. Notifications: ${
			req.headers['twitch-eventsub-message-type'] === 'notification'
		}`
	);
	if (req.headers['twitch-eventsub-message-type'] === 'notification') {
		if (
			['twitch-eventsub-message-id', 'twitch-eventsub-message-timestamp'].some(
				(header) => !req.headers[header]
			)
		) {
			Logger.error(null, 'Notifications - 403 - Missing Headers.');
			return res.status(403).end();
		}

		const expectedSig = `sha256=${createHmac('sha256', process.env.REQUEST_SECRET)
			.update(
				(((req.headers['twitch-eventsub-message-id'] as string) +
					req.headers['twitch-eventsub-message-timestamp']) as string) + JSON.stringify(req.body)
			)
			.digest('hex')}`;
		const actualSig = req.headers['twitch-eventsub-message-signature'];

		if (expectedSig !== actualSig) {
			Logger.error(null, 'Notifications - 403 - Invalid Signature');
			return res.status(403).end();
		}

		const { type } = req.body.subscription;
		const broadcasterId = req.body.subscription.condition.broadcaster_user_id;
		if (type !== 'stream.online') {
			Logger.error(null, `Notifications - 400 - Not stream.online, instead ${type}`);
			return res.status(204).end();
		}

		await mongo.connect();
		let accessTokenDocument = await mongo
			.db('data')
			.collection('other')
			.findOne({ accessToken: { $exists: true } });

		let response = await getStreamData(accessTokenDocument?.accessToken, broadcasterId);
		let statusCode = res.statusCode;
		let json = await response.json();

		if (statusCode !== 200) {
			const { access_token: accessToken, expires_in: expiresIn } = await (
				await fetch(
					`https://id.twitch.tv/oauth2/token?client_id=${process.env.CLIENT_ID}&client_secret=${
						process.env.CLIENT_SECRET
					}&grant_type=${'client_credentials'}`,
					{ method: 'POST' }
				)
			).json();

			accessTokenDocument = (
				await mongo
					.db('data')
					.collection('other')
					.findOneAndUpdate(
						{ accessToken: { $exists: true } },
						{ $set: { accessToken, expiresIn } },
						{ upsert: true, returnDocument: 'after' }
					)
			).value;

			response = await getStreamData(accessToken, broadcasterId);
			json = await response.json();
			statusCode = res.statusCode;
		}

		if (statusCode !== 200) {
			Logger.error(null, 'Notifications - 500 - Invalid access code.');
			return res.status(500).end();
		} else if (!json.data.length || !json.data[0]?.broadcaster_name) {
			Logger.error(null, 'Notifications - 400 - Invalid stream data.');
			return res.status(400).end();
		}

		const { title } = json.data[0];

		sendMessageToDiscordWebhook(broadcasterId, title);

		Logger.info('Notifications - 204 - Success');

		return res.status(204).setHeader('Content-Type', 'text/plain').end();
	}

	const expectedSig = `sha256=${createHmac('sha256', process.env.REQUEST_SECRET)
		.update(
			(((req.headers['twitch-eventsub-message-id'] as string) +
				req.headers['twitch-eventsub-message-timestamp']) as string) + JSON.stringify(req.body)
		)
		.digest('hex')}`;
	const actualSig = req.headers['twitch-eventsub-message-signature'];

	if (expectedSig !== actualSig) {
		Logger.error(null, 'Challenge - 403 - Invalid Signature');
		return res.status(403).end();
	}

	const { challenge } = req.body;

	Logger.info(`Challenge - 204 - Success`);

	return res.status(200).setHeader('Content-Type', 'text/plain').send(challenge);
};

/**
 * Send a message to a Discord webhook.
 * @param title The title of the stream.
 * @param broadcasterId The ID of the broadcaster.
 * @returns The response from Discord.
 */
async function sendMessageToDiscordWebhook(broadcasterId: string, title: string) {
	await mongo.connect();

	const broadcasterDocument = await mongo
		.db('data')
		.collection('broadcasters')
		.findOne({ broadcasterId });

	console.log(broadcasterId, title, broadcasterDocument);

	if (!broadcasterDocument) return;

	if (broadcasterDocument.isSpacedriveBroadcaster && !title?.toLowerCase().includes('spacedrive')) {
		return Logger.info(
			`${broadcasterDocument.broadcasterUsername} does not have "spacedrive" in their title.`
		);
	}

	const message: RESTPostAPIWebhookWithTokenJSONBody = {
		username: broadcasterDocument.broadcasterUsername,
		avatar_url: broadcasterDocument.broadcasterAvatarURL,
		content: `${
			broadcasterDocument.broadcasterUsername
		} is now [live on Twitch](<https://twitch.tv/${broadcasterDocument.broadcasterUsername}>)!${
			title ? ` They'll be streaming ${title}.` : ''
		}`
	};

	Logger.info(
		`Sending webhook message with content of ${message.content} into ${broadcasterDocument?.webhookURL}`
	);

	const a = await fetch(broadcasterDocument.webhookURL, {
		method: 'POST',
		body: JSON.stringify(message),
		headers: { 'Content-Type': 'application/json' }
	});

	console.log(a, await a.text());
	return a;
}

/**
 * Get data about a Twitch stream from the Twitch API.
 * @param token Our Twitch API token.
 * @param broadcasterId The broadcaster ID of the stream.
 * @returns Data about the stream returned by the Twitch API.
 */
function getStreamData(token: string, broadcasterId: string) {
	return fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Client-ID': process.env.CLIENT_ID
		}
	});
}
