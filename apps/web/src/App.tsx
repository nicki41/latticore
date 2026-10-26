import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { AppLoadingOverlay } from "@/components/layout/AppLoadingOverlay";
import { RequireAuth, RedirectIfAuthed, RedirectIfSetupDone } from "@/components/layout/RequireAuth";
import SetupPage from "@/routes/SetupPage";
import LoginPage from "@/routes/LoginPage";
import DashboardPage from "@/routes/DashboardPage";
import AccountSettingsPage from "@/routes/settings/AccountSettingsPage";
import AllocationsPage from "@/routes/servers/AllocationsPage";
import NetworksPage from "@/routes/servers/NetworksPage";
import ServerNetworkPage from "@/routes/servers/ServerNetworkPage";
import CreateServerPage from "@/routes/servers/CreateServerPage";
import ServerDetailLayout from "@/routes/servers/ServerDetailLayout";
import ServerOverviewPage from "@/routes/servers/ServerOverviewPage";
import ServerConsolePage from "@/routes/servers/ServerConsolePage";
import ServerFilesPage from "@/routes/servers/ServerFilesPage";
import ServerPluginsPage from "@/routes/servers/ServerPluginsPage";
import ServerPlayersPage from "@/routes/servers/ServerPlayersPage";
import ServerBackupsPage from "@/routes/servers/ServerBackupsPage";
import ServerSchedulerPage from "@/routes/servers/ServerSchedulerPage";
import ServerSettingsPage from "@/routes/servers/ServerSettingsPage";
import ModrinthBrowsePage from "@/routes/modrinth/ModrinthBrowsePage";
import UsersPage from "@/routes/admin/UsersPage";
import UserEditPage from "@/routes/admin/UserEditPage";
import RolesPage from "@/routes/admin/RolesPage";
import AuditLogPage from "@/routes/admin/AuditLogPage";
import NotFound from "@/routes/NotFound";

export default function App() {
  return (
    <AuthProvider>
      <AppLoadingOverlay />
      <Routes>
        <Route
          path="/setup"
          element={
            <RedirectIfSetupDone>
              <SetupPage />
            </RedirectIfSetupDone>
          }
        />
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <LoginPage />
            </RedirectIfAuthed>
          }
        />

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />

            <Route path="servers/allocations" element={<AllocationsPage />} />
            <Route path="servers/networks" element={<NetworksPage />} />
            <Route path="servers/new" element={<CreateServerPage />} />
            <Route path="servers/:id" element={<ServerDetailLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<ServerOverviewPage />} />
              <Route path="console" element={<ServerConsolePage />} />
              <Route path="files" element={<ServerFilesPage />} />
              <Route path="plugins" element={<ServerPluginsPage />} />
              <Route path="players" element={<ServerPlayersPage />} />
              <Route path="network" element={<ServerNetworkPage />} />
              <Route path="backups" element={<ServerBackupsPage />} />
              <Route path="scheduler" element={<ServerSchedulerPage />} />
              <Route path="settings" element={<ServerSettingsPage />} />
            </Route>

            <Route path="modrinth" element={<ModrinthBrowsePage />} />

            <Route path="admin/users" element={<UsersPage />} />
            <Route path="admin/users/:id" element={<UserEditPage />} />
            <Route path="admin/roles" element={<RolesPage />} />
            <Route path="admin/audit-log" element={<AuditLogPage />} />

            <Route path="settings" element={<AccountSettingsPage />} />
            <Route path="settings/account" element={<AccountSettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
