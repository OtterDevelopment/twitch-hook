import { NextApiRequest, NextApiResponse } from 'next';
import Logger from '../../lib/classes/Logger';
import mongo from '../../utils/mongo';

export default async (req: NextApiRequest, res: NextApiResponse) => {
	if (req.headers['secret'] !== process.env.REQUEST_SECRET) {
		Logger.error(null, 'Register Broadcasters - 403 - Invalid Secret');
		return res.status(403).end();
	}

	const { access_token: accessToken, expires_in: expiresIn } = await (
		await fetch(
			`https://id.twitch.tv/oauth2/token?client_id=${process.env.CLIENT_ID}&client_secret=${
				process.env.CLIENT_SECRET
			}&grant_type=${'client_credentials'}`,
			{ method: 'POST' }
		)
	).json();

	await mongo
		.db('data')
		.collection('other')
		.updateOne(
			{ accessToken: { $exists: true } },
			{ $set: { accessToken, expiresIn } },
			{ upsert: true }
		);

	const broadcastersDocument = await mongo.db('data').collection('broadcasters').find({}).toArray();

	const responses = await Promise.all(
		broadcastersDocument.map((broadcasterDocument) =>
			registerBroadcaster(accessToken, broadcasterDocument.broadcasterId).then((response) => {
				Logger.info(
					`Registered ${broadcasterDocument.broadcasterId} - Status Code ${response.status}`,
					response.status === 202 ? '' : response.json()
				);
			})
		)
	);

	return res.status(200).json({ message: `Registered ${responses.length} broadcasters.` });
};

/**
 * Register to receive events from Twitch.
 * @param token Our Twitch API token.
 * @param broadcasterId The broadcaster ID to register.
 * @returns The response from Twitch.
 */
async function registerBroadcaster(token: string, broadcasterId: string) {
	return fetch(
		`https://api.twitch.tv/helix/eventsub/subscriptions?broadcaster_id=${broadcasterId}`,
		{
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Client-ID': process.env.CLIENT_ID,
				'Content-Type': process.env.CLIENT_ID
			},
			body: JSON.stringify({
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
		}
	);
}
