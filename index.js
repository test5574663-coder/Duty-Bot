client.once("clientReady", async () => {
  console.log("Bot ready");

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  // ❗ xoá toàn bộ slash cũ trong guild
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: [] }
  );

  // ✅ đăng lại lệnh mới
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands refreshed");
});
