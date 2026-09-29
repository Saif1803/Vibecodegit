//! Pure window-placement math: where to put the popup given the monitor work area
//! and (optionally) the tray icon rect. All values are physical pixels.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Area {
    fn right(&self) -> i32 {
        self.x + self.w
    }
    fn bottom(&self) -> i32 {
        self.y + self.h
    }
}

/// Top-left position for a `win_w`×`win_h` window, `margin` px from the screen edges.
///
/// The taskbar edge is inferred from where the tray icon sits relative to the work
/// area (the work area excludes the taskbar). Without a tray rect, falls back to the
/// bottom-right corner of the work area. The result is always clamped inside it.
pub fn place(work: Area, tray: Option<Area>, win_w: i32, win_h: i32, margin: i32) -> (i32, i32) {
    let (x, y) = match tray {
        None => (work.right() - win_w - margin, work.bottom() - win_h - margin),
        Some(t) => {
            let cx = t.x + t.w / 2;
            let cy = t.y + t.h / 2;
            if cy >= work.bottom() {
                (cx - win_w / 2, work.bottom() - win_h - margin)
            } else if cy < work.y {
                (cx - win_w / 2, work.y + margin)
            } else if cx < work.x {
                (work.x + margin, cy - win_h / 2)
            } else if cx >= work.right() {
                (work.right() - win_w - margin, cy - win_h / 2)
            } else {
                // Icon inside the work area (overflow flyout, auto-hidden taskbar): sit just above it.
                (cx - win_w / 2, t.y - win_h - margin)
            }
        }
    };
    (
        clamp(x, work.x + margin, work.right() - win_w - margin),
        clamp(y, work.y + margin, work.bottom() - win_h - margin),
    )
}

/// Shrinks `work` so it no longer overlaps `bar`. Windows reports the full monitor as
/// the work area when the taskbar auto-hides, but the bar still slides up over that
/// strip (always, on a tray click), so the popup must stay clear of it.
pub fn exclude_bar(work: Area, bar: Area) -> Area {
    let overlaps = bar.x < work.right()
        && bar.right() > work.x
        && bar.y < work.bottom()
        && bar.bottom() > work.y;
    if !overlaps {
        return work;
    }
    let horizontal = bar.w >= bar.h;
    let mut w = work;
    if horizontal && bar.y <= work.y {
        w.y = bar.bottom();
        w.h = work.bottom() - w.y;
    } else if horizontal {
        w.h = bar.y - work.y;
    } else if bar.x <= work.x {
        w.x = bar.right();
        w.w = work.right() - w.x;
    } else {
        w.w = bar.x - work.x;
    }
    w
}

/// Where the user left the window, pulled back inside `work` if it has drifted off
/// (a monitor unplugged, the resolution changed). No margin: it's the user's spot.
pub fn keep_inside(work: Area, x: i32, y: i32, win_w: i32, win_h: i32) -> (i32, i32) {
    (clamp(x, work.x, work.right() - win_w), clamp(y, work.y, work.bottom() - win_h))
}

/// The user moved or resized the window since we placed it: more than a couple of pixels
/// off on either axis (smaller differences are DPI rounding).
pub fn differs(placed: (i32, i32), actual: (i32, i32)) -> bool {
    (placed.0 - actual.0).abs() > 2 || (placed.1 - actual.1).abs() > 2
}

/// Like `i32::clamp`, but never panics when the window is larger than the area.
fn clamp(v: i32, lo: i32, hi: i32) -> i32 {
    v.min(hi).max(lo)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 1920×1080 screen, 48 px taskbar at the bottom.
    const WORK: Area = Area { x: 0, y: 0, w: 1920, h: 1032 };
    const W: i32 = 380;
    const H: i32 = 500;
    const M: i32 = 12;

    #[test]
    fn no_tray_falls_back_to_bottom_right() {
        assert_eq!(place(WORK, None, W, H, M), (1920 - W - M, 1032 - H - M));
    }

    #[test]
    fn bottom_taskbar_centers_over_icon_above_taskbar() {
        let tray = Area { x: 1500, y: 1040, w: 32, h: 32 };
        assert_eq!(place(WORK, Some(tray), W, H, M), (1516 - W / 2, 1032 - H - M));
    }

    #[test]
    fn icon_near_right_edge_is_clamped_on_screen() {
        let tray = Area { x: 1880, y: 1040, w: 32, h: 32 };
        assert_eq!(place(WORK, Some(tray), W, H, M).0, 1920 - W - M);
    }

    #[test]
    fn top_taskbar_places_below_it() {
        let work = Area { x: 0, y: 48, w: 1920, h: 1032 };
        let tray = Area { x: 1500, y: 8, w: 32, h: 32 };
        assert_eq!(place(work, Some(tray), W, H, M), (1516 - W / 2, 48 + M));
    }

    #[test]
    fn left_taskbar_places_beside_it() {
        let work = Area { x: 60, y: 0, w: 1860, h: 1080 };
        let tray = Area { x: 14, y: 900, w: 32, h: 32 };
        assert_eq!(place(work, Some(tray), W, H, M), (60 + M, 1080 - H - M));
    }

    #[test]
    fn right_taskbar_places_beside_it() {
        let work = Area { x: 0, y: 0, w: 1860, h: 1080 };
        let tray = Area { x: 1874, y: 300, w: 32, h: 32 };
        assert_eq!(place(work, Some(tray), W, H, M), (1860 - W - M, 316 - H / 2));
    }

    #[test]
    fn icon_inside_work_area_sits_above_icon() {
        let tray = Area { x: 1500, y: 900, w: 32, h: 32 };
        assert_eq!(place(WORK, Some(tray), W, H, M), (1516 - W / 2, 900 - H - M));
    }

    #[test]
    fn secondary_monitor_offsets_are_respected() {
        let work = Area { x: -1920, y: 0, w: 1920, h: 1032 };
        assert_eq!(place(work, None, W, H, M), (-W - M, 1032 - H - M));
    }

    const FULL: Area = Area { x: 0, y: 0, w: 1920, h: 1080 };

    #[test]
    fn autohide_bottom_bar_is_excluded() {
        let bar = Area { x: 0, y: 1020, w: 1920, h: 60 };
        assert_eq!(exclude_bar(FULL, bar), Area { x: 0, y: 0, w: 1920, h: 1020 });
    }

    #[test]
    fn autohide_top_and_side_bars_are_excluded() {
        let top = Area { x: 0, y: 0, w: 1920, h: 60 };
        assert_eq!(exclude_bar(FULL, top), Area { x: 0, y: 60, w: 1920, h: 1020 });
        let left = Area { x: 0, y: 0, w: 70, h: 1080 };
        assert_eq!(exclude_bar(FULL, left), Area { x: 70, y: 0, w: 1850, h: 1080 });
        let right = Area { x: 1850, y: 0, w: 70, h: 1080 };
        assert_eq!(exclude_bar(FULL, right), Area { x: 0, y: 0, w: 1850, h: 1080 });
    }

    #[test]
    fn non_overlapping_bar_leaves_work_area_alone() {
        // Normal taskbar: the work area already excludes it.
        let bar = Area { x: 0, y: 1032, w: 1920, h: 48 };
        assert_eq!(exclude_bar(WORK, bar), WORK);
        // Taskbar on another monitor.
        let other = Area { x: 1920, y: 1020, w: 1920, h: 60 };
        assert_eq!(exclude_bar(FULL, other), FULL);
    }

    #[test]
    fn a_dragged_window_stays_put_unless_it_drifted_off_screen() {
        assert_eq!(keep_inside(WORK, 200, 300, W, H), (200, 300));
        // Flush against the edges is allowed (no margin for the user's spot).
        assert_eq!(keep_inside(WORK, 0, 1032 - H, W, H), (0, 1032 - H));
        // A monitor that went away, or a window hanging off the right: pulled back in.
        assert_eq!(keep_inside(WORK, 2500, -40, W, H), (1920 - W, 0));
        let second = Area { x: -1920, y: 0, w: 1920, h: 1032 };
        assert_eq!(keep_inside(second, -100, 900, W, H), (-W, 1032 - H));
        // Bigger than the area: top-left corner stays visible.
        let tiny = Area { x: 0, y: 0, w: 300, h: 400 };
        assert_eq!(keep_inside(tiny, 50, 50, W, H), (0, 0));
    }

    #[test]
    fn only_real_moves_and_resizes_count() {
        assert!(!differs((100, 100), (101, 98)));
        assert!(differs((100, 100), (140, 100)));
        assert!(differs((380, 500), (380, 520)));
    }

    #[test]
    fn window_larger_than_area_pins_to_top_left_margin() {
        let tiny = Area { x: 0, y: 0, w: 300, h: 400 };
        assert_eq!(place(tiny, None, W, H, M), (M, M));
    }
}
