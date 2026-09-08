import { login } from "./actions";
import styles from "./login.module.css";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className={styles.main}>
      <form action={login} className={styles.form}>
        <h1 className={styles.title}>Tracker</h1>
        <input
          className={styles.input}
          type="email"
          name="email"
          placeholder="Email"
          autoComplete="email"
          required
        />
        <input
          className={styles.input}
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          required
        />
        {error && <p className={styles.error}>Wrong email or password.</p>}
        <button className={styles.button} type="submit">
          Log in
        </button>
      </form>
    </main>
  );
}
