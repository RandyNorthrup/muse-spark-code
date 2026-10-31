ENTRY(reset)
SECTIONS {
  . = 0x08000000;
  .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) }
  . = 0x20000000;
  .data : { *(.data*) }
  .bss : { *(.bss*) }
}
