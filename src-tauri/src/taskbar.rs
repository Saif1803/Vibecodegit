//! Where the Windows taskbar is, even while auto-hidden (its shown position).

use crate::placement::Area;

#[cfg(windows)]
pub fn rect() -> Option<Area> {
    use std::ffi::c_void;

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct AppBarData {
        cb_size: u32,
        hwnd: *mut c_void,
        callback_message: u32,
        edge: u32,
        rc: Rect,
        lparam: isize,
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHAppBarMessage(message: u32, data: *mut AppBarData) -> usize;
    }

    const ABM_GETTASKBARPOS: u32 = 5;

    let mut data = AppBarData {
        cb_size: std::mem::size_of::<AppBarData>() as u32,
        hwnd: std::ptr::null_mut(),
        callback_message: 0,
        edge: 0,
        rc: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        lparam: 0,
    };
    // SAFETY: `data` is a correctly sized, initialized APPBARDATA that outlives the call.
    if unsafe { SHAppBarMessage(ABM_GETTASKBARPOS, &mut data) } == 0 {
        return None;
    }
    let rc = data.rc;
    Some(Area { x: rc.left, y: rc.top, w: rc.right - rc.left, h: rc.bottom - rc.top })
}

#[cfg(not(windows))]
pub fn rect() -> Option<Area> {
    None
}
