declare global {
	namespace NodeJS {
		interface ProcessEnv {
			BASE_URL: string;
			CLIENT_ID: string;
			CLIENT_SECRET: string;
			REQUEST_SECRET: string;
			SPACEDRIVE_WEBHOOK_URL: string;
			POLARS_CAFE_WEBHOOK_URL: string;
		}
	}
}

export {};
