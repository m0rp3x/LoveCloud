using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoveCloud.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSetupAppearanceAvatars : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AvatarId",
                table: "Users",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AvatarId",
                table: "PairSettings",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Locale",
                table: "PairSettings",
                type: "text",
                nullable: false,
                defaultValue: "ru");

            migrationBuilder.AddColumn<string>(
                name: "Theme",
                table: "PairSettings",
                type: "text",
                nullable: false,
                defaultValue: "berry");

            migrationBuilder.CreateTable(
                name: "SetupSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "text", nullable: false),
                    CsrfToken = table.Column<string>(type: "text", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SetupSessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Avatars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BlobKey = table.Column<string>(type: "text", nullable: false),
                    PendingSessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Ready = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Avatars", x => x.Id);
                    table.CheckConstraint("CK_Avatar_Ready", "NOT \"Ready\" OR \"PendingSessionId\" IS NULL");
                    table.ForeignKey(
                        name: "FK_Avatars_SetupSessions_PendingSessionId",
                        column: x => x.PendingSessionId,
                        principalTable: "SetupSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SetupState",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Completed = table.Column<bool>(type: "boolean", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    TokenHash = table.Column<string>(type: "text", nullable: true),
                    ClaimSessionId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SetupState", x => x.Id);
                    table.CheckConstraint("CK_Setup_Completed", "NOT \"Completed\" OR (\"TokenHash\" IS NULL AND \"ClaimSessionId\" IS NULL)");
                    table.CheckConstraint("CK_Setup_Singleton", "\"Id\" = 1");
                    table.ForeignKey(
                        name: "FK_SetupState_SetupSessions_ClaimSessionId",
                        column: x => x.ClaimSessionId,
                        principalTable: "SetupSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Users_AvatarId",
                table: "Users",
                column: "AvatarId");

            migrationBuilder.CreateIndex(
                name: "IX_PairSettings_AvatarId",
                table: "PairSettings",
                column: "AvatarId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Pair_Locale",
                table: "PairSettings",
                sql: "\"Locale\" IN ('ru','en')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Pair_Theme",
                table: "PairSettings",
                sql: "\"Theme\" IN ('berry','rose','cloud')");

            migrationBuilder.CreateIndex(
                name: "IX_Avatars_BlobKey",
                table: "Avatars",
                column: "BlobKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Avatars_PendingSessionId",
                table: "Avatars",
                column: "PendingSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_SetupSessions_TokenHash",
                table: "SetupSessions",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SetupState_ClaimSessionId",
                table: "SetupState",
                column: "ClaimSessionId");

            migrationBuilder.AddForeignKey(
                name: "FK_PairSettings_Avatars_AvatarId",
                table: "PairSettings",
                column: "AvatarId",
                principalTable: "Avatars",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Users_Avatars_AvatarId",
                table: "Users",
                column: "AvatarId",
                principalTable: "Avatars",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PairSettings_Avatars_AvatarId",
                table: "PairSettings");

            migrationBuilder.DropForeignKey(
                name: "FK_Users_Avatars_AvatarId",
                table: "Users");

            migrationBuilder.DropTable(
                name: "Avatars");

            migrationBuilder.DropTable(
                name: "SetupState");

            migrationBuilder.DropTable(
                name: "SetupSessions");

            migrationBuilder.DropIndex(
                name: "IX_Users_AvatarId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_PairSettings_AvatarId",
                table: "PairSettings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Pair_Locale",
                table: "PairSettings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Pair_Theme",
                table: "PairSettings");

            migrationBuilder.DropColumn(
                name: "AvatarId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "AvatarId",
                table: "PairSettings");

            migrationBuilder.DropColumn(
                name: "Locale",
                table: "PairSettings");

            migrationBuilder.DropColumn(
                name: "Theme",
                table: "PairSettings");
        }
    }
}
