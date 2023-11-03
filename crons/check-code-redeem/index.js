export const definitions = {
	name: "check-code-redeem",
	expression: "0 */30 * * * *",
	description: "Check and redeem code from prydwen and HoyoLab",
	code: (async function codeRedeem () {
		if (!sr.Config.get("CHECK_CODE_REDEEM")) {
			this.stop();
			return;
		}
		
		const fs = await import("fs");
		const skippedCodes = [
			{
				code: "STARRAILGIFT",
				rewards: "50 Stellar Jades + EXP materials"
			},
			{
				code: "BTN5EL69P6K3",
				rewards: "50 Stellar Jades + 10k credits"
			}
		];

		this.data.codes ??= [];
		this.data.firstRun ??= true;

		const res = await sr.Got({
			url: "https://www.prydwen.gg/star-rail/",
			responseType: "text"
		});

		const codes = [];
		const $ = sr.Utils.cheerio(res.body);

		const $codes = $(".codes .box");
		for (let i = 0; i < $codes.length; i++) {
			const $code = $($codes[i]);
			const code = $code.find(".code").text().replace(" NEW!", "");
			const rewards = $code.find(".rewards").text();
			codes.push({ code, rewards });
		}

		try {
			const savedCodes = await import("./codes.js");
			this.data.codes = savedCodes.default;
		}
		catch {
			const path = "./crons/check-code-redeem/codes.js";
			fs.writeFileSync(path, `export default ${JSON.stringify([...skippedCodes, ...codes], null, 4)}`);
			this.data.codes = [...skippedCodes, ...codes];
		}

		if (this.data.firstRun) {
			this.data.firstRun = false;
			return;
		}

		const hoyoRes = await sr.Got({
			url: "https://bbs-api-os.hoyolab.com/community/painter/wapi/circle/channel/guide/material",
			searchParams: {
				game_id: 6
			},
			headers: {
				"x-rpc-app_version": "2.42.0",
				"x-rpc-client_type": 4
			}
		});

		if (hoyoRes.statusCode !== 200) {
			sr.Logger.json({
				message: "Error while retrieving redeem code from HoyoLab",
				args: {
					statusCode: hoyoRes.statusCode,
					body: hoyoRes.body
				}
			});

			return;
		}

		const exchangeGroup = hoyoRes.body.data.modules.find(i => i.exchange_group !== null);
		if (!exchangeGroup) {
			sr.Logger.json({
				message: "No exchange group found in HoyoLab response",
				args: {
					body: hoyoRes.body
				}
			});

			return;
		}

		const pictureHash = [
			{
				hash: "77cb5426637574ba524ac458fa963da0_6409817950389238658",
				name: "Stellar Jade"
			},
			{
				hash: "7cb0e487e051f177d3f41de8d4bbc521_2556290033227986328",
				name: "Refined Aether"
			},
			{
				hash: "508229a94e4fa459651f64c1cd02687a_6307505132287490837",
				name: "Traveler's Guide"
			},
			{
				hash: "0b12bdf76fa4abc6b4d1fdfc0fb4d6f5_4521150989210768295",
				name: "Credit"
			}
		];

		const pendingCodes = [];
		const { bonuses } = exchangeGroup.exchange_group;
		if (bonuses.length !== 0) {
			const avaliableCodes = bonuses.filter(i => i.code_status === "ON");
			for (const code of avaliableCodes) {
				const rewards = code.icon_bonuses.map(i => ({
					code: i.bonus_num,
					reward: `${i.bonus_num} ${pictureHash.find(j => i.icon_url.includes(j.hash))?.name}` ?? "Unknown"
				}));

				pendingCodes.push({ code: code.exchange_code, rewards: rewards.map(i => `${i.reward}`).join(" + ") });
			}
		}

		const newCodes = [];
		const hoyoCodes = pendingCodes.filter(i => !this.data.codes.some(j => j.code === i.code));
		if (hoyoCodes.length !== 0) {
			newCodes.push(...hoyoCodes);
		}

		const prydwenCodes = codes.filter(i => !this.data.codes.some(j => j.code === i.code));
		if (prydwenCodes.length !== 0) {
			newCodes.push(...prydwenCodes);
		}

		if (newCodes.length === 0) {
			return;
		}

		this.data.codes.push(...newCodes);
		fs.unlinkSync("./crons/check-code-redeem/codes.js");
		fs.writeFileSync("./crons/check-code-redeem/codes.js", `export default ${JSON.stringify(this.data.codes, null, 4)}`);

		const message = newCodes.map(i => `Code: ${i.code}\nRewards: ${i.rewards}`).join("\n\n");
		sr.Logger.info(`New code(s) found:\n${message}`);

		if (sr.Discord && sr.Discord.active) {
			await sr.Discord.send({
				color: 0xBB0BB5,
				title: "Honkai: Star Rail New Code",
				description: message,
				timestamp: new Date(),
				footer: {
					text: "Honkai: Star Rail New Code"
				}
			});
		}

		if (sr.Telegram && sr.Telegram.active) {
			await sr.Telegram.send(message);
		}
	})
};
