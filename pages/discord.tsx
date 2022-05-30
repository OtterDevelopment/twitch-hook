import { NextPage } from 'next';
import { useEffect } from 'react';

const DiscordPage: NextPage = () => {
	useEffect(() => {
		window.location.href = 'https://discord.gg/VvE5ucuJmW';
	}, []);

	return <></>;
};

export default DiscordPage;
