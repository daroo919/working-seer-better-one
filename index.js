import "dotenv/config";
import fs from "fs";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";

const TOKEN = process.env.TOKEN;
const AI_KEY = process.env.AI_API_KEY;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;

// ======================
// 권한 설정
// ======================
const ALLOWED_ROLES = [
  "1484178229886713856",
  "1424211270067949598"
];

// ======================
// WARN DB
// ======================
const WARN_FILE = "./warnings.json";

if (!fs.existsSync(WARN_FILE)) {
  fs.writeFileSync(WARN_FILE, "{}");
}

function loadWarns() {
  return JSON.parse(fs.readFileSync(WARN_FILE));
}

function saveWarns(data) {
  fs.writeFileSync(WARN_FILE, JSON.stringify(data, null, 2));
}

// ======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ======================
// 재판 상태
// ======================
const trials = new Map();

// ======================
// 명령어
// ======================
const commands = [

new SlashCommandBuilder()
.setName("help")
.setDescription("명령어 목록"),

new SlashCommandBuilder()
.setName("clear")
.setDescription("채팅 삭제")
.addIntegerOption(o =>
  o.setName("amount").setRequired(true)
),

new SlashCommandBuilder()
.setName("kick")
.setDescription("유저 킥")
.addUserOption(o =>
  o.setName("user").setRequired(true)
),

new SlashCommandBuilder()
.setName("ban")
.setDescription("유저 밴")
.addUserOption(o =>
  o.setName("user").setRequired(true)
),

new SlashCommandBuilder()
.setName("unban")
.setDescription("밴 해제")
.addStringOption(o =>
  o.setName("userid").setRequired(true)
),

new SlashCommandBuilder()
.setName("timeout")
.setDescription("타임아웃")
.addUserOption(o =>
  o.setName("user").setRequired(true)
)
.addIntegerOption(o =>
  o.setName("minutes").setRequired(true)
),

new SlashCommandBuilder()
.setName("warn")
.setDescription("경고")
.addUserOption(o =>
  o.setName("user").setRequired(true)
)
.addStringOption(o =>
  o.setName("reason")
),

new SlashCommandBuilder()
.setName("warnings")
.setDescription("경고 조회")
.addUserOption(o =>
  o.setName("user").setRequired(true)
),

new SlashCommandBuilder()
.setName("ai")
.setDescription("AI 질문")
.addStringOption(o =>
  o.setName("prompt").setRequired(true)
),

// ⭐ 재판 추가
new SlashCommandBuilder()
.setName("재판")
.setDescription("AI 재판")
.addUserOption(o =>
  o.setName("피고").setRequired(true)
)
.addStringOption(o =>
  o.setName("이유").setRequired(true)
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

  console.log("✅ 명령어 등록 완료");
});

// ======================
// 권한 체크
// ======================
function hasRole(member) {
  return member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
}

async function log(guild, message) {
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (ch) ch.send(message);
}

// ======================
// 환영
// ======================
client.on("guildMemberAdd", member => {
  const ch = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (ch) ch.send(`🎉 ${member} 환영`);
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
감정 없이 논리로 판단한다.
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

const cmd = interaction.commandName;

// ⭐ 재판은 권한 예외
if (cmd !== "재판" && !hasRole(interaction.member)) {
  return interaction.reply({
    content: "❌ 권한 없음",
    ephemeral: true
  });
}

// ======================
// 재판
// ======================
if (cmd === "재판") {

  const defendant = interaction.options.getUser("피고");
  const reason = interaction.options.getString("이유");

  const id = interaction.channel.id;

  if (trials.has(id)) {
    return interaction.reply("이미 재판 진행 중이다.");
  }

  trials.set(id, true);

  await interaction.reply(
    `📂 재판 시작\n\n피고: ${defendant}\n혐의: ${reason}\n\n30초 안에 변론해라.`
  );

  const filter = m => m.author.id === defendant.id;

  const collector = interaction.channel.createMessageCollector({
    filter,
    time: 30000,
    max: 1
  });

  let defense = "변론 없음";

  collector.on("collect", m => {
    defense = m.content;
  });

  collector.on("end", async () => {
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

    trials.delete(id);
  });
}

// ======================
// WARN (버그 수정 포함)
// ======================
if (cmd === "warn") {

  const user = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason") || "없음";

  const data = loadWarns();
  if (!data[user.id]) data[user.id] = [];

  if (data[user.id].length >= 3) {
    return interaction.reply("이미 최대 경고 상태다.");
  }

  data[user.id].push(reason);
  saveWarns(data);

  const count = data[user.id].length;

  await log(interaction.guild,
    `⚠️ ${user.tag} (${count}/3)\n${reason}`
  );

  if (count >= 3) {
    try {
      const m = await interaction.guild.members.fetch(user.id);

      if (m.communicationDisabledUntilTimestamp > Date.now()) {
        return interaction.reply("이미 타임아웃 상태다.");
      }

      await m.timeout(10 * 60000);
      log(interaction.guild, "🚨 자동 타임아웃");
    } catch (e) {
      console.error(e);
    }
  }

  return interaction.reply(`경고 (${count}/3)`);
}

// ======================
// AI
// ======================
if (cmd === "ai") {

  const prompt = interaction.options.getString("prompt");
  await interaction.deferReply();

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    })
  });

  const json = await res.json();
  const reply =
    json.choices?.[0]?.message?.content || "응답 실패";

  interaction.editReply(reply.slice(0, 2000));
}

});

client.login(TOKEN);
