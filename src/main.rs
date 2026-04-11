mod analyzer;
mod correlation;
mod correlation_engine;
mod dashboard;
mod explainer;
mod local_context;
mod model_profile;
mod proxy;
mod session_admin;
mod settings_admin;
mod stats;
mod store;
mod types;

use clap::Parser;
use stats::StatsStore;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Parser, Debug, Clone)]
#[command(name = "claude-proxy", about = "Ultra-fast API logging proxy for Claude Code")]
struct Args {
    #[arg(long)]
    target: String,

    #[arg(long, default_value_t = 8000)]
    port: u16,

    #[arg(long, default_value_t = 3000)]
    dashboard_port: u16,

    #[arg(long)]
    data_dir: Option<PathBuf>,

    #[arg(long)]
    model_config: Option<PathBuf>,

    #[arg(long, default_value_t = 0.5)]
    stall_threshold: f64,

    #[arg(long, default_value_t = 3000)]
    slow_ttft_threshold: u64,

    #[arg(long, default_value_t = 2 * 1024 * 1024)]
    max_body_size: usize,

    #[arg(long, default_value_t = false, action = clap::ArgAction::SetTrue)]
    open_browser: bool,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let args = Args::parse();

    if let Some(model_config_path) = &args.model_config {
        eprintln!(
            "--model-config is not wired in this phase yet: {}",
            model_config_path.display()
        );
        std::process::exit(2);
    }

    let target = args.target.trim_end_matches('/').to_string();
    let data_dir = args.data_dir.unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".claude")
            .join("api-logs")
    });
    let _ = std::fs::create_dir_all(&data_dir);

    let claude_root = dirs::home_dir().unwrap_or_default().join(".claude");

    let store = Arc::new(StatsStore::new(
        50_000,
        data_dir.clone(),
        args.stall_threshold,
        (args.slow_ttft_threshold as f64) / 1000.0,
        args.max_body_size,
        claude_root,
    ));

    store.load_from_db();

    print_banner(
        &target,
        args.port,
        args.dashboard_port,
        &data_dir,
        store.database_path(),
    );

    let dashboard_url = format!("http://127.0.0.1:{}", args.dashboard_port);

    let store_dash = store.clone();
    let dash_port = args.dashboard_port;
    tokio::spawn(async move {
        if let Err(err) = dashboard::run_dashboard(store_dash, dash_port).await {
            eprintln!("Dashboard startup failed: {err}");
        }
    });

    if args.open_browser {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        let _ = open::that(&dashboard_url);
    }

    if let Err(err) = proxy::run_proxy(store, &target, args.port).await {
        eprintln!("Proxy startup failed: {err}");
        std::process::exit(1);
    }
}

fn print_banner(
    target: &str,
    proxy_port: u16,
    dash_port: u16,
    storage_dir: &std::path::Path,
    db_path: &std::path::Path,
) {
    let cyan = "\x1b[96m";
    let bold = "\x1b[1m";
    let dim = "\x1b[2m";
    let yellow = "\x1b[93m";
    let green = "\x1b[92m";
    let reset = "\x1b[0m";

    println!();
    println!("  {bold}══════════════════════════════════════════════════{reset}");
    println!("  {bold}{cyan}  Claude Code Proxy — Ultra-Fast API Monitor{reset}");
    println!("  {bold}══════════════════════════════════════════════════{reset}");
    println!();
    println!("  {green}▸{reset} Target API:    {bold}{target}{reset}");
    println!("  {green}▸{reset} Proxy:         {bold}http://127.0.0.1:{proxy_port}{reset}");
    println!("  {green}▸{reset} Dashboard:     {bold}http://127.0.0.1:{dash_port}{reset}");
    println!("  {green}▸{reset} Storage dir:   {dim}{}{reset}", storage_dir.display());
    println!("  {green}▸{reset} SQLite DB:     {dim}{}{reset}", db_path.display());
    println!();
    println!("  {yellow}Set in Claude Code:{reset}");
    println!("  {bold}\"ANTHROPIC_BASE_URL\": \"http://127.0.0.1:{proxy_port}\"{reset}");
    println!();
    println!("  {dim}Press Ctrl+C to stop{reset}");
    println!("  {bold}══════════════════════════════════════════════════{reset}");
    println!();
}

#[cfg(test)]
mod main {
    use super::*;

    mod tests {
        use super::*;

        #[test]
        fn parse_args_exposes_v2_threshold_flags() {
            use clap::Parser;

            let args = Args::parse_from([
                "claude-proxy",
                "--target",
                "https://api.anthropic.com",
                "--slow-ttft-threshold",
                "3000",
                "--stall-threshold",
                "0.5",
            ]);

            assert_eq!(args.slow_ttft_threshold, 3000);
            assert!((args.stall_threshold - 0.5).abs() < f64::EPSILON);
        }
    }
}
