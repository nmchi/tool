import { useState, type FormEvent } from 'react';
import { LoaderCircle, LockKeyhole, Network } from 'lucide-react';
import { api } from '../api';

import { Button, Field } from '../components/ui';
export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      sessionStorage.setItem('entity-access-token', token);
      await api('/state');
      await onLogin();
    } catch (e) {
      sessionStorage.removeItem('entity-access-token');
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-screen">
      <form onSubmit={submit} className="login-card">
        <span className="brand-mark">
          <Network size={25} />
        </span>
        <h1>Mở workspace của bạn</h1>
        <p>Nhập mã truy cập được cấu hình trên máy chủ.</p>
        <Field label="Mã truy cập">
          <input
            required
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}Kết nối
          workspace
        </Button>
      </form>
    </div>
  );
}
