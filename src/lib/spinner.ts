import chalk from "chalk";
import yoctoSpinner from "yocto-spinner";

export interface SpinnerOptions {
	text: string;
	color?: "green" | "yellow" | "blue" | "red";
	noSpinner?: boolean;
}

function shouldDisableSpinner(): boolean {
	if (process.env.OL_SPINNER === "false") return true;
	if (process.env.CI) return true;

	const args = process.argv;
	if (
		args.includes("--json") ||
		args.includes("--ndjson") ||
		args.includes("--no-spinner")
	) {
		return true;
	}

	return false;
}

export class LoadingSpinner {
	private spinnerInstance: ReturnType<typeof yoctoSpinner> | null = null;

	start(options: SpinnerOptions) {
		if (!process.stdout.isTTY || options.noSpinner || shouldDisableSpinner()) {
			return this;
		}

		const colorFn = chalk[options.color || "blue"];
		this.spinnerInstance = yoctoSpinner({ text: colorFn(options.text) });
		this.spinnerInstance.start();
		return this;
	}

	succeed(text?: string) {
		if (this.spinnerInstance) {
			this.spinnerInstance.success(text ? chalk.green(`✓ ${text}`) : undefined);
			this.spinnerInstance = null;
		}
	}

	fail(text?: string) {
		if (this.spinnerInstance) {
			this.spinnerInstance.error(text ? chalk.red(`✗ ${text}`) : undefined);
			this.spinnerInstance = null;
		}
	}

	stop() {
		if (this.spinnerInstance) {
			this.spinnerInstance.stop();
			this.spinnerInstance = null;
		}
	}
}

export async function withSpinner<T>(
	options: SpinnerOptions,
	asyncOperation: () => Promise<T>,
): Promise<T> {
	const spinner = new LoadingSpinner().start(options);

	try {
		const result = await asyncOperation();
		spinner.stop();
		return result;
	} catch (error) {
		spinner.fail();
		throw error;
	}
}
