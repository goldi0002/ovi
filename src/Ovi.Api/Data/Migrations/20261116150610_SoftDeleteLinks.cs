using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ovi.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SoftDeleteLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Links",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Links");
        }
    }
}
