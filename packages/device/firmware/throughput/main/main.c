/*
 * Throughput spike — how fast can the host actually push bytes to this board?
 *
 * `docs/ARCHITECTURE.md` rested the whole host-renders design on one unmeasured
 * assumption: that USB-CDC to an ESP32-C6 carries dirty rectangles comfortably.
 * Its compression figures were stated as percentages of a 700 KB/s floor that
 * had never been observed — a conservative guess at what a 12 Mbps full-speed
 * link gives after protocol overhead.
 *
 * This firmware measures it. It does nothing else: no display, no SPI, no
 * decoding. It reads from USB-Serial/JTAG as fast as it can, throws the bytes
 * away, and once a second reports how many arrived. Deliberately minimal — if
 * it did more, a slow result would be ambiguous between the link and our code,
 * and the point is to get a number for the link alone.
 *
 * Read the report with `tools/usb-throughput.ts`, which drives the host side.
 *
 * The bytes are discarded rather than checked. A spike that verified content
 * would be measuring memcmp as much as the link, and correctness of the
 * transport is the blitter's problem, not this one's. The reported total is
 * enough to catch the failure that matters: the host believing it sent more
 * than the device received, which is what a full buffer looks like from above.
 */
#include <stdio.h>

#include "driver/usb_serial_jtag.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/*
 * One read of 4KB. USB full-speed moves 64 bytes per packet, so this is 64
 * packets per call — large enough that the per-call overhead is not what we
 * end up measuring, small enough to stay in internal RAM without thought.
 */
#define RX_CHUNK 4096

/* Report once a second. Frequent enough to see the rate settle, rare enough
 * that the report itself is noise: ~30 bytes against a link we expect to be
 * carrying hundreds of kilobytes in the same window. */
#define REPORT_INTERVAL_US 1000000

static uint8_t rx[RX_CHUNK];

void app_main(void) {
  usb_serial_jtag_driver_config_t config = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
  config.rx_buffer_size = RX_CHUNK;
  config.tx_buffer_size = 256;
  ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&config));

  uint64_t total = 0;
  uint64_t window = 0;
  int64_t window_start = esp_timer_get_time();

  for (;;) {
    /*
     * A timeout rather than a block, so the report still goes out during a
     * gap in the stream. Without it the firmware looks dead whenever the host
     * pauses, and "dead" and "receiving nothing" are the same picture.
     */
    int read = usb_serial_jtag_read_bytes(rx, RX_CHUNK, pdMS_TO_TICKS(50));
    if (read > 0) {
      total += (uint64_t)read;
      window += (uint64_t)read;
    }

    int64_t now = esp_timer_get_time();
    int64_t elapsed = now - window_start;
    if (elapsed >= REPORT_INTERVAL_US) {
      /* Bytes this window, microseconds it actually took, and the running
       * total. The host divides the first two rather than assuming the window
       * was exactly a second — a busy read loop overshoots. */
      char line[64];
      int length = snprintf(line, sizeof line, "RX %llu %lld %llu\n",
                            (unsigned long long)window, (long long)elapsed,
                            (unsigned long long)total);
      usb_serial_jtag_write_bytes((const uint8_t *)line, (size_t)length,
                                  pdMS_TO_TICKS(20));
      window = 0;
      window_start = now;
    }
  }
}
