-- Muse Spark Code (Unofficial). Qt Creator scans <directory>/<directory>.lua.
return {
  Id = "MuseSpark",
  Name = "Muse Spark Code (Unofficial)",
  Version = "0.1.0",
  CompatVersion = "0.1.0",
  VendorId = "RandyNorthrup",
  Category = "Language Client",
  License = "MIT",
  Experimental = true,
  DisabledByDefault = false,
  setup = function()
    return require("init").setup()
  end,
}
