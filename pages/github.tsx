import { NextPage } from 'next';
import { useEffect } from 'react';

const GitHubPage: NextPage = () => {
	useEffect(() => {
		window.location.href = 'https://github.com/OtterDevelopment/twitch-hook';
	}, []);

	return <></>;
};

export default GitHubPage;
