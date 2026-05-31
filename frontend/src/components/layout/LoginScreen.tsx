import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "./Brand";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "sonner";

export function LoginScreen() {
  const { login, changePassword } = useAuthStore();

  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  // Password change state
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [changeLoginName, setChangeLoginName] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changeBusy, setChangeBusy] = useState(false);

  const handleLogin = async () => {
    if (!loginName.trim() || !loginPassword.trim()) {
      setLoginError("请输入账号和密码");
      return;
    }
    setLoginBusy(true);
    setLoginError("");
    try {
      await login(loginName.trim(), loginPassword);
    } catch (e) {
      setLoginError(
        e instanceof Error ? e.message : "登录失败，请检查账号和密码",
      );
      setLoginBusy(false);
    }
  };

  const handleChangePassword = async () => {
    if (!changeLoginName.trim() || !oldPassword || !newPassword) {
      toast.error("请填写完整信息");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setChangeBusy(true);
    try {
      await changePassword(changeLoginName.trim(), oldPassword, newPassword);
      toast.success("密码修改成功，请使用新密码登录");
      setShowPasswordForm(false);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "密码修改失败",
      );
    } finally {
      setChangeBusy(false);
    }
  };

  const handleLoginKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
    setLoginError("");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#eef2f7]">
      <div className="w-full max-w-[420px] rounded-lg border border-border bg-card p-6 shadow-app">
        {/* Brand */}
        <div className="mb-5 flex justify-center">
          <Brand />
        </div>

        {/* Login form */}
        <Label htmlFor="loginName" className="mb-1 block text-sm">
          账号
        </Label>
        <Input
          id="loginName"
          name="login"
          placeholder="请输入账号"
          autoComplete="username"
          spellCheck={false}
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
          onKeyDown={handleLoginKeyDown}
          onInput={() => setLoginError("")}
          className="mb-3"
        />

        <Label htmlFor="loginPassword" className="mb-1 block text-sm">
          密码
        </Label>
        <Input
          id="loginPassword"
          name="password"
          type="password"
          placeholder="请输入密码"
          autoComplete="current-password"
          value={loginPassword}
          onChange={(e) => setLoginPassword(e.target.value)}
          onKeyDown={handleLoginKeyDown}
          onInput={() => setLoginError("")}
          className="mb-3"
        />

        {loginError && (
          <p className="text-sm text-destructive mb-3">{loginError}</p>
        )}

        <Button
          className="w-full mb-2"
          onClick={handleLogin}
          disabled={loginBusy}
        >
          {loginBusy ? "登录中…" : "登录"}
        </Button>

        <Button
          variant="link"
          className="w-full text-muted-foreground"
          onClick={() => {
            setShowPasswordForm(!showPasswordForm);
            if (!showPasswordForm) {
              setChangeLoginName(loginName);
            }
          }}
        >
          修改登录密码
        </Button>

        {/* Password change panel */}
        {showPasswordForm && (
          <div className="mt-3 space-y-3 border-t border-border pt-3 animate-fade-in">
            <Label htmlFor="changeLoginName" className="block text-sm">
              账号
            </Label>
            <Input
              id="changeLoginName"
              autoComplete="username"
              spellCheck={false}
              value={changeLoginName}
              onChange={(e) => setChangeLoginName(e.target.value)}
            />

            <Label htmlFor="oldPassword" className="block text-sm">
              旧密码
            </Label>
            <Input
              id="oldPassword"
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />

            <Label htmlFor="newPassword" className="block text-sm">
              新密码
            </Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />

            <Label htmlFor="confirmPassword" className="block text-sm">
              确认新密码
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            <Button
              className="w-full"
              onClick={handleChangePassword}
              disabled={changeBusy}
            >
              {changeBusy ? "保存中…" : "保存新密码"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
