# Explicit requirements rather than leaning on `main`'s implicit dependency on
# every component in the build. It is the same list the includes in main.c
# spell out, and naming it keeps a missing component a build error here rather
# than a link error somewhere further away.
idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS ""
    REQUIRES esp_lcd
             esp_driver_spi
             esp_driver_gpio
             esp_driver_usb_serial_jtag
             freertos)
