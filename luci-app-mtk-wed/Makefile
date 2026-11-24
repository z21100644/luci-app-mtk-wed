# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

PKG_VERSION:=2.1.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI status page for MediaTek PPE / WED hardware offload
LUCI_DESCRIPTION:=Shows the MediaTek Filogic PPE flow table, WED (Wi-Fi offload) \
	state, Ethernet ports, CPU frequency and per-band Wi-Fi health, and toggles \
	hardware flow offload and the mt76 wed_enable option.
LUCI_DEPENDS:=+luci-base +rpcd +jsonfilter +iw
LUCI_PKGARCH:=all

# Disable legacy csstidy (breaks CSS custom properties, calc() spacing, @keyframes)
LUCI_MINIFY_CSS:=0
override CONFIG_LUCI_CSSTIDY:=

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=z21100644

define Package/luci-app-mtk-wed/conffiles
/etc/config/mtk_wed
endef

define Build/Prepare/luci-app-mtk-wed
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/luci.mtk_wed \
		$(PKG_BUILD_DIR)/root/etc/init.d/mtk-wed
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
