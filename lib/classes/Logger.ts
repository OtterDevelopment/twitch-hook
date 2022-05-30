/* eslint-disable no-console */
import {
	bgGreenBright,
	bgMagentaBright,
	bgRedBright,
	bgYellowBright,
	blackBright,
	bold
} from 'colorette';
import { format } from 'util';

export class Logger {
	/**
	 * Get the current timestamp.
	 * @returns The current timestamp in the format of [DD/MM/YYYY @ HH:mm:SS].
	 */
	private static get timestamp(): string {
		const now = new Date();
		const [year, month, day] = now.toISOString().substr(0, 10).split('-');
		return `${day}/${month}/${year} @ ${now.toISOString().substr(11, 8)}`;
	}

	/**
	 * Log out a debug statement.
	 * @param args The arguments to log out.
	 */
	public debug(...args: string | any): void {
		console.log(bold(bgMagentaBright(`[${Logger.timestamp}]`)), bold(format(...args)));
	}

	/**
	 * Log out a debug statement.
	 * @param args The arguments to log out.
	 */
	public info(...args: string | any): void {
		console.log(bold(bgGreenBright(blackBright(`[${Logger.timestamp}]`))), bold(format(...args)));
	}

	/**
	 * Log out a debug statement.
	 * @param args The arguments to log out.
	 */
	public warn(...args: string | any): void {
		console.log(bold(bgYellowBright(blackBright(`[${Logger.timestamp}]`))), bold(format(...args)));
	}

	/**
	 * Log out an error statement.
	 * @param error The error to log out.
	 * @param args TBe arguments to log out.
	 */
	public error(error: any | null, ...args: string | any): void {
		if (error)
			console.log(bold(bgRedBright(`[${Logger.timestamp}]`)), error, bold(format(...args)));
		else console.log(bold(bgRedBright(`[${Logger.timestamp}]`)), bold(format(...args)));
	}
}

export default new Logger();
