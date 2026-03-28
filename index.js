import "dotenv/config";
import fs from "fs";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

const TOKEN = process.env.TOKEN;
const AI_KEY = process.env.AI_API_KEY;

// ======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ======================
const trials = new Map();

// ======================
// 명령어
// ======================
const commands = [
  new SlashCommandBuilder()
    .setName("재판")
    .setDescription("AI 재판")
    .addUserOption(o =>
      o.setName("피고")
       .setDescription("재판 받을 유저")
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("이유")
       .setDescription("고소 이유")
       .setRequired(true)
    )
].map(c => c.toJSON());

// ======================
client.once("clientReady", async () => {
  console.log(`✅ 로그인: ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
});

// ======================
// AI 판결
// ======================
async function judge(defendant, reason, defense) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
너는 냉정하고 논리적인 판사다.
히구루마 히로미처럼 말한다.
감정 없이 책임과 결과 중심으로 판단한다.
`
        },
        {
          role: "user",
          content: `
피고: ${defendant}
혐의: ${reason}
변론: ${defense}

형식:
[판결]:
[이유]:
[벌칙]:
`
        }
      ]
    })
  });

  const json = await res.json();
  return json.choices?.[0]?.message?.content || "판결 실패";
}

// ======================
// 명령 처리
// ======================
client.on("interactionCreate", async interaction => {

if (!interaction.isChatInputCommand()) return;

if (interaction.commandName === "재판") {

  const defendant = interaction.options.getUser("피고");
  const reason = interaction.options.getString("이유");

  const id = interaction.channel.id;

  if (trials.has(id)) {
    return interaction.reply("이미 재판 진행 중이다.");
  }

  trials.set(id, true);

  await interaction.reply(
    `📂 재판 시작\n\n피고: ${defendant}\n혐의: ${reason}\n\n변론해라. (입력하면 바로 판결)`
  );

  const filter = m => m.author.id === defendant.id;

  const collector = interaction.channel.createMessageCollector({
    filter,
    time: 120000, // 2분 fallback
    max: 1
  });

  // ✅ 말하면 즉시 판결
  collector.on("collect", async m => {
    const defense = m.content;

    try {
      const result = await judge(
        defendant.username,
        reason,
        defense
      );

      await interaction.followUp(`⚖️ 판결\n\n${result}`);
    } catch (e) {
      console.error(e);
      await interaction.followUp("판결 중 오류");
    }

    collector.stop();
    trials.delete(id);
  });

  // ✅ 아무 말 안 하면 자동 판결
  collector.on("end", async collected => {
    if (collected.size === 0) {
      try {
        const result = await judge(
          defendant.username,
          reason,
          "변론 없음"
        );

        await interaction.followUp(`⚖️ 판결\n\n${result}`);
      } catch (e) {
        console.error(e);
        await interaction.followUp("판결 중 오류");
      }

      trials.delete(id);
    }
  });
}

});

client.login(TOKEN);
