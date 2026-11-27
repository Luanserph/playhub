#[cfg(desktop)]
use std::fs::OpenOptions;
#[cfg(desktop)]
use std::io::Write;
#[cfg(desktop)]
use std::net::TcpStream;
#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::process::{Child, Command, Stdio};
#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::Manager;

#[cfg(all(desktop, target_os = "windows"))]
use std::os::windows::process::CommandExt;

#[cfg(all(desktop, target_os = "windows"))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(desktop)]
struct ServerChild(Mutex<Option<Child>>);

#[cfg(desktop)]
fn resolve_server_binary(exe_dir: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let candidates = [
        exe_dir.join("playhub-server.exe"),
        exe_dir.join("playhub-server-x86_64-pc-windows-msvc.exe"),
        exe_dir
            .join("binaries")
            .join("playhub-server-x86_64-pc-windows-msvc.exe"),
    ];

    #[cfg(not(target_os = "windows"))]
    let candidates = [
        exe_dir.join("playhub-server"),
        exe_dir.join("binaries").join("playhub-server"),
    ];

    candidates.into_iter().find(|p| p.is_file())
}

#[cfg(desktop)]
fn resolve_companion_binary(exe_dir: &Path, base_name: &str) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let direct = exe_dir.join(format!("{base_name}.exe"));
        if direct.is_file() {
            return direct;
        }
        let suffixed = exe_dir.join(format!("{base_name}-x86_64-pc-windows-msvc.exe"));
        if suffixed.is_file() {
            return suffixed;
        }
        let in_binaries = exe_dir
            .join("binaries")
            .join(format!("{base_name}-x86_64-pc-windows-msvc.exe"));
        if in_binaries.is_file() {
            return in_binaries;
        }
        direct
    }

    #[cfg(not(target_os = "windows"))]
    {
        exe_dir.join(base_name)
    }
}

#[cfg(desktop)]
fn terminate_server_process(mut child: Child) {
    #[cfg(target_os = "windows")]
    {
        let pid = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(desktop)]
#[tauri::command]
fn stop_server_for_update(state: tauri::State<'_, ServerChild>) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(child) = guard.take() {
            terminate_server_process(child);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![stop_server_for_update]);

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(desktop)]
            {
                let data_dir = app.path().app_data_dir()?;
                std::fs::create_dir_all(&data_dir)?;
                let log_path = data_dir.join("server.log");

                let exe_dir = std::env::current_exe()?
                    .parent()
                    .map(|p| p.to_path_buf())
                    .ok_or_else(|| {
                        std::io::Error::new(
                            std::io::ErrorKind::NotFound,
                            "Não foi possível resolver o diretório do executável.",
                        )
                    })?;

                // Só inicia o sidecar se a porta 127.0.0.1:3001 ainda não estiver ocupada (ex: dev externo)
                if TcpStream::connect("127.0.0.1:3001").is_err() {
                    if let Some(server_bin) = resolve_server_binary(&exe_dir) {
                        let ffmpeg_path = resolve_companion_binary(&exe_dir, "ffmpeg");
                        let ffprobe_path = resolve_companion_binary(&exe_dir, "ffprobe");

                        let mut cmd = Command::new(&server_bin);
                        cmd.current_dir(&exe_dir)
                            .env("PLAYHUB_DATA_DIR", data_dir.to_string_lossy().as_ref())
                            .env("FFMPEG_PATH", ffmpeg_path.to_string_lossy().as_ref())
                            .env("FFPROBE_PATH", ffprobe_path.to_string_lossy().as_ref())
                            .env("HOST", "0.0.0.0")
                            .env("PORT", "3001");

                        #[cfg(target_os = "windows")]
                        {
                            cmd.creation_flags(CREATE_NO_WINDOW);
                        }

                        if let Ok(mut log_file) = OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&log_path)
                        {
                            let _ = writeln!(
                                log_file,
                                "\n--- [PlayHub] Iniciando backend: {} ---",
                                server_bin.display()
                            );
                            if let Ok(err_file) = log_file.try_clone() {
                                cmd.stdout(Stdio::from(log_file));
                                cmd.stderr(Stdio::from(err_file));
                            }
                        }

                        match cmd.spawn() {
                            Ok(child) => {
                                if let Ok(mut guard) = app.state::<ServerChild>().0.lock() {
                                    *guard = Some(child);
                                }
                            }
                            Err(err) => {
                                log::error!(
                                    "Falha ao iniciar backend {} : {}",
                                    server_bin.display(),
                                    err
                                );
                            }
                        }
                    } else {
                        if let Ok(mut log_file) = OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&log_path)
                        {
                            let _ = writeln!(
                                log_file,
                                "\n--- [PlayHub] ERRO: playhub-server não encontrado em {} ---",
                                exe_dir.display()
                            );
                        }
                        log::error!(
                            "Binário playhub-server não encontrado em {}",
                            exe_dir.display()
                        );
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = _event {
                if let Ok(mut guard) = _app_handle.state::<ServerChild>().0.lock() {
                    if let Some(child) = guard.take() {
                        terminate_server_process(child);
                    }
                }
            }
        });
}
