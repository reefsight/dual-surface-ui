# Rust user local toolchain readiness

Date: 2026-10-14, Asia/Bangkok. Producer: `/root`.
Scope: authorized user-local installation and synthetic console readiness only.

## Authorization and host

The maintainer authorized user-local Rust installation without admin and
confirmed the current normal, unlocked Desktop without UAC/remote/background
session. The [resume work item](../work-items/Rust-user-local-native-resume-2026-10-14.md)
limits this change. No native gate or release is accepted here.

Read-only host observations were Windows X64, `UserInteractive = true` and
the producer process session ID `1` (`af9c85`). These are not measurements of
a future native worker's Desktop/identity guards.
Existing MSVC component discovery through the installed `vswhere.exe` returned
`C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools` (`e5204a`).
No Visual Studio installation, elevation or security change was performed.
An additional own-shell role check returned `currentShellAdministrator=False`
(`c3df5d`, EXIT 0); it queried only the current identity and published no name/SID.

## Installer verification and installation

The official [Windows installation guidance](https://rust-lang.github.io/rustup/installation/windows.html)
and [manual download/checksum guidance](https://rust-lang.github.io/rustup/installation/other.html)
were read before execution. Installer origin was
`https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe`;
the companion `.sha256` was obtained from the same HTTPS origin.

The initial checksum command refused execution (`a80a93`, EXIT 1): PowerShell
returned the checksum content as `System.Byte[]` rather than a decoded string.
This was not accepted as an integrity pass. The response was explicitly UTF-8
decoded and checked for maximum length 256 and a 64-hex checksum; the downloaded file
matched (`90f8b6`, EXIT 0). Installer `--help` identified rustup-init 1.29.1.

Actual and expected installer SHA-256 were both:
`6f4bef66261261fcb43131be8720bab817d403a09edec7455c371974b90bdb7e`.
The installer hash was checked again immediately before installation.

The successful invocation used `-y --profile minimal --default-host
x86_64-pc-windows-msvc --default-toolchain stable --no-modify-path`.
Only command-local `CARGO_HOME` and `RUSTUP_HOME` were assigned to this user's
`C:\Users\phichayut.kot\.cargo` and `C:\Users\phichayut.kot\.rustup`.
Persistent PATH was not modified; commands use absolute tool paths.

Installation producer session `68244` completed EXIT 0 (`727366`):

| Toolchain field | Actual result |
| --- | --- |
| Host/installed target | `x86_64-pc-windows-msvc` |
| rustc | `1.99.0 (b940084d7 2026-09-28)` |
| rustc commit | `b940084d7eb6a299eb4bfeb8e34901bc051e7ac4` |
| Cargo | `1.99.0 (5f94df478 2026-08-27)` |
| LLVM | `23.1.1` |
| rustup home | `C:\Users\phichayut.kot\.rustup` |

The `stable` channel resolved to these actual versions at installation time;
future P4.4 qualification must freeze its exact candidate/toolchain inputs
before measurement rather than silently updating the channel.

## Actual link and execution smoke

A separate synthetic console source outside the repository contained only:

```rust
fn main() {
    println!("dual_surface_user_local_rust_toolchain_smoke_ok");
}
```

In the newly created user Temp directory
`dual-surface-rustup-fa0249faa21b4d8fbc1f454bb732f045`, the absolute rustc proxy
compiled `user_local_toolchain_smoke.rs` with edition 2024, crate name
`user_local_toolchain_smoke`, debuginfo 0 and an explicit local output executable.
Compilation/linking and execution succeeded (`458e54`/`c5209d`, EXIT 0), printing
exactly `dual_surface_user_local_rust_toolchain_smoke_ok`.
No Rust SDK/host/normalizer implementation or native accessibility API ran.
The Temp source/installer/executable are retained; no cleanup deletes existing
user toolchains or evidence.

## Frozen native packet remains separate

Actual fixed Node admission (`3b5b0e`, EXIT 0) and existing exact DLL reflection
of only `SuiteFreeze.Admit` (`c5209d`, EXIT 0) agreed on:

- Suite20 `sha256:0011376b411742d76078d0b67a65cc213236a38678d83869b6fc79f8578d3416`.
- Suite DLL `sha256:1ec86ebb15d99fa0b6a0385f5dfaae3224de02d102846767fe3a4a56583200c3`.
- Fixture DLL `sha256:05491f5a44d01e9a25f5098d86a4919abb9bb8d6f4d44a4050dcf2560107161d`.

The reflection check invoked no Program.Main, worker, fixture, UIA getter,
SDK/build or native scenario. Pure admission is not S2 proof. Fresh prerequisite
gates, the separately bound root final go/no-go, original native first/repeat
and independent runtime artifact review remain required.
