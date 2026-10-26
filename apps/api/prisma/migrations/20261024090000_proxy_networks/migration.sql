-- AlterTable
ALTER TABLE "Server" ADD COLUMN "exposePort" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ServerNetworkMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proxyServerId" TEXT NOT NULL,
    "backendServerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerNetworkMember_proxyServerId_fkey" FOREIGN KEY ("proxyServerId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServerNetworkMember_backendServerId_fkey" FOREIGN KEY ("backendServerId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ServerNetworkMember_backendServerId_key" ON "ServerNetworkMember"("backendServerId");

-- CreateIndex
CREATE INDEX "ServerNetworkMember_proxyServerId_idx" ON "ServerNetworkMember"("proxyServerId");

-- CreateIndex
CREATE UNIQUE INDEX "ServerNetworkMember_proxyServerId_name_key" ON "ServerNetworkMember"("proxyServerId", "name");
