import { AddLink } from "../components/AddLink";
import { Icon } from "../components/Icon";
import { navigate, useLocation } from "../lib/router";

export function AddPage() {
  const { params } = useLocation();
  const popup = params.get("popup") === "1";
  const initial = { url: params.get("url") ?? undefined, title: params.get("title") ?? undefined, text: params.get("text") ?? undefined };
  const done = () => {
    if (popup && window.opener) window.close();
    else navigate("/", { replace: true });
  };
  return (
    <div className="auth-page">
      <div className="auth-card wide stack">
        <div className="brand"><span className="brand-mark"><Icon name="link" size={18} /></span>JanganLupa</div>
        <AddLink initial={initial} onDone={done} onOpen={(id) => navigate(`/?link=${id}`)} />
      </div>
    </div>
  );
}
